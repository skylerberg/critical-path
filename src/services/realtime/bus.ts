import type { AppContext } from '../../types/index';
import { logger } from '../../utils/logger';
// Imported from the modules directly, not the barrel, so the sender and its
// node:http / node:dns dependencies stay out of every module that touches the bus.
import { isWebhookEvent } from '../webhooks/events';
import { enqueueDeliveries } from '../webhooks/queue';

export interface RealtimeEnvelope {
  type: string;
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

// Types that leave behind no activity or comment row, so a board read would not
// report them as changed either. An unclassified new type therefore raises a dot
// the next board open clears, which is the safe way round: a dot too many costs
// one glance, a dot missing costs the feature.
const UNCHANGED_TYPES: ReadonlySet<string> = new Set([
  'project_created',
  'project_updated',
  'project_deleted',
  'project_position_updated',
  'project_seen',
  PROJECT_CHANGED,
  // Not board content, and the dot would be one every viewer sees for a change
  // none of them may read. Membership is also what keeps signup working: the
  // dot below reads the calling user, and a claim during signup has none.
  INVITATIONS_CHANGED,
  'column_created',
  'column_updated',
  'column_tasks_reordered',
  'label_created',
  'label_updated',
  'image_created',
  'image_deleted',
  'comment_updated',
  'comment_deleted',
  // Both take their card off the board, and its activity goes with it, so a
  // reader would find nothing to notice.
  'task_deleted',
  'task_archived',
  'column_tasks_archived',
  'bulk_tasks_archived',
]);

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

export function publishAfterCommit(
  c: Pick<AppContext, 'get'>,
  type: string,
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

  if (!UNCHANGED_TYPES.has(type)) {
    const changed = c.get('changedProjectIds');
    if (!changed.has(projectId)) {
      changed.add(projectId);
      // The actor rides along instead of the server withholding the event from
      // them: their own other devices still have to update the board they are
      // looking at, and only the dot has to ignore it.
      const actorUserId = c.get('user').id;
      hooks.push(async () => {
        publish({
          type: PROJECT_CHANGED,
          project_id: projectId,
          data: { id: projectId, actor_user_id: actorUserId },
          // A member sitting on the project list subscribes to no room, and this
          // exists for exactly them.
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
