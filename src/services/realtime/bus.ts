import type { PublicContext } from '../../types/index';
import { logger } from '../../utils/logger';
// Imported from the modules directly, not the barrel, so the sender and its
// node:http / node:dns dependencies stay out of every module that touches the bus.
import { enqueueDeliveries } from '../webhooks/queue';
import { isWebhookEvent, raisesUnseenDot } from './eventCatalog';
import type { AccountEventType, ProjectEventType, RealtimeEventType } from './eventCatalog';

interface RealtimeEnvelope {
  type: RealtimeEventType;
  project_id: string | null;
  data: unknown;
}

export interface PublishOptions {
  // Exact recipients, no access re-check — for delete/removal events whose
  // rows are gone post-commit, so access can no longer be recomputed.
  recipientUserIds?: string[];
  // Candidate every authed socket (access-checked) instead of only the
  // project's subscribers — for project list events.
  broadcast?: boolean;
  // For events whose subject only editors may read. The delivery layer applies
  // it, so no publisher can widen it and none has to be trusted to scope it.
  editorsOnly?: boolean;
}

export interface BusEntry extends RealtimeEnvelope, PublishOptions {}

export type BusSubscriber = (entry: BusEntry) => void;

export const SESSIONS_REVOKED = 'sessions_revoked';
export const USER_UPDATED = 'user_updated';
export const PROJECT_CHANGED = 'project_changed';
export const INVITATIONS_CHANGED = 'invitations_changed';

const subscribers = new Set<BusSubscriber>();

export type RemotePublisher = (entry: BusEntry) => Promise<void>;

let remotePublish: RemotePublisher | null = null;

export function deliverLocal(entry: BusEntry): void {
  for (const subscriber of subscribers) {
    subscriber(entry);
  }
}

// With a remote publisher, local delivery happens only via the subscription
// echo, so every replica (publisher included) receives events through one
// path. On remote failure, deliver locally: degrade rather than go silent.
export function publish(entry: BusEntry): void {
  if (remotePublish) {
    remotePublish(entry).catch((err: unknown) => {
      logger.warn({
        msg: 'Remote bus publish failed; delivering locally',
        type: entry.type,
        error: err instanceof Error ? err.message : String(err),
      });
      deliverLocal(entry);
    });
    return;
  }
  deliverLocal(entry);
}

export function setRemotePublisher(publisher: RemotePublisher | null): void {
  remotePublish = publisher;
}

export function subscribeBus(subscriber: BusSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetBus(): void {
  subscribers.clear();
  remotePublish = null;
}

// Split by scope so the project id cannot disagree with the type: an account
// event published against a project, or a project event published with null,
// would silently skip both the unseen dot and the webhook queue.
export function publishAfterCommit(
  c: Pick<PublicContext, 'get'>,
  type: AccountEventType,
  projectId: null,
  data: unknown,
  opts?: PublishOptions
): void;
export function publishAfterCommit(
  c: Pick<PublicContext, 'get'>,
  type: ProjectEventType,
  projectId: string,
  data: unknown,
  opts?: PublishOptions
): void;
export function publishAfterCommit(
  c: Pick<PublicContext, 'get'>,
  type: RealtimeEventType,
  projectId: string | null,
  data: unknown,
  opts?: PublishOptions
): void {
  const hooks = c.get('postCommitHooks');
  // A separate hook from the webhook flush below: the runner catches each hook
  // independently, so an enqueue failure can never suppress the publish.
  hooks.push(async () => {
    publish({ type, project_id: projectId, data, ...opts });
  });

  if (projectId === null) {
    return;
  }

  if (raisesUnseenDot(type)) {
    const changed = c.get('changedProjectIds');
    if (!changed.has(projectId)) {
      changed.add(projectId);
      // The actor rides along rather than being withheld the event: their other
      // devices still have to update, and only the dot has to ignore it.
      //
      // Null when the caller has no session — a signup claiming its invitations
      // is the one such path — which dots the project for everyone rather than
      // failing. No type published without a session raises a dot today, so this
      // is the fallback that keeps that changing from being a 500.
      const actorUserId = c.get('user')?.id ?? null;
      hooks.push(async () => {
        publish({
          type: PROJECT_CHANGED,
          project_id: projectId,
          data: { id: projectId, actor_user_id: actorUserId },
          // A member sitting on the project list subscribes to no room.
          broadcast: true,
        });
      });
    }
  }

  if (!isWebhookEvent(type)) {
    return;
  }
  // A post-commit hook rather than a bus subscriber: with Redis every replica
  // sees every entry through the subscription echo, so a subscriber would
  // enqueue one copy per replica.
  const pending = c.get('webhookEvents');
  if (pending.length === 0) {
    hooks.push(() => enqueueDeliveries(pending));
  }
  pending.push({ type, project_id: projectId, data });
}
