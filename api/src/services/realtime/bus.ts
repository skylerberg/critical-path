import type { PublicContext } from '../../types/index';
import { logger } from '../../utils/logger';
// Imported from the modules directly, not the barrel, so the sender and its
// node:http / node:dns dependencies stay out of every module that touches the bus.
import { enqueueDeliveries } from '../webhooks/queue';
import { eventScope, raisesUnseenDot } from './eventCatalog';
import type {
  DispatchedEventType,
  NamedRecipientEventType,
  ProjectEventType,
  RealtimeEventType,
} from './eventCatalog';
import { isWebhookEnvelope } from './payloads';
import type { RealtimeEnvelope, RealtimePayloads } from './payloads';

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

// What an account event may carry. broadcast and editorsOnly are project-scoped
// answers — both route the entry through deliverProjectScoped, which returns on
// the null project id — so offering them here would only be offering two more
// ways to publish into a void. recipientUserIds is required rather than
// optional, because for these types it is the whole delivery mechanism.
export interface NamedRecipientOptions {
  recipientUserIds: string[];
}

export type BusEntry = RealtimeEnvelope & PublishOptions;

export type BusSubscriber = (entry: BusEntry) => void;

export const SESSIONS_REVOKED = 'sessions_revoked';
export const USER_UPDATED = 'user_updated';
export const ACCOUNT_UPDATED = 'account_updated';
export const PROJECT_CHANGED = 'project_changed';
export const INVITATIONS_CHANGED = 'invitations_changed';

const subscribers = new Set<BusSubscriber>();

export type RemotePublisher = (entry: BusEntry) => Promise<void>;

let remotePublish: RemotePublisher | null = null;

// The one place an envelope enters from outside this process, and so the one
// place the union is an assumption rather than something the publish site
// proved. The payload is deliberately not re-validated: a schema that drifted
// from its publisher would then drop live events on every replica at once.
// A type outside the catalogue is refused, though, because handleBusEntry and
// deliver() dispatch on it.
export function parseBusEntry(raw: unknown): BusEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const {
    type,
    project_id: projectId,
    data,
  } = raw as { type?: unknown; project_id?: unknown; data?: unknown };
  if (typeof type !== 'string') return null;
  const scope = eventScope(type);
  if (scope === null) return null;
  if (scope === 'account' ? projectId !== null : typeof projectId !== 'string') return null;
  if (typeof data !== 'object' || data === null) return null;
  return raw as BusEntry;
}

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
// would silently skip both the unseen dot and the webhook queue. Generic over
// the event type so `data` is checked against that type's row in
// REALTIME_PAYLOAD_SCHEMAS rather than accepted as unknown.
//
// The account half is split again by the catalogue's delivery column, because
// the two kinds have opposite requirements and the failure is silent either
// way: a namedRecipients type published without a recipient list falls through
// to deliverProjectScoped and is dropped on the null project id, while a
// dispatched type published *with* one would take the exact-recipient shortcut
// and bypass the branch that is supposed to decide its audience.
export function publishAfterCommit<T extends NamedRecipientEventType>(
  c: Pick<PublicContext, 'get'>,
  type: T,
  projectId: null,
  data: RealtimePayloads[T],
  opts: NamedRecipientOptions
): void;
export function publishAfterCommit<T extends DispatchedEventType>(
  c: Pick<PublicContext, 'get'>,
  type: T,
  projectId: null,
  data: RealtimePayloads[T]
): void;
export function publishAfterCommit<T extends ProjectEventType>(
  c: Pick<PublicContext, 'get'>,
  type: T,
  projectId: string,
  data: RealtimePayloads[T],
  opts?: PublishOptions
): void;
export function publishAfterCommit(
  c: Pick<PublicContext, 'get'>,
  type: RealtimeEventType,
  projectId: string | null,
  data: RealtimePayloads[RealtimeEventType],
  opts?: PublishOptions
): void {
  // The overloads are what check that type, projectId and data agree. An
  // implementation signature necessarily sees the three widened independently,
  // and no single non-generic type can restate their pairing, so this is the one
  // place the envelope is asserted rather than inferred.
  const entry = { type, project_id: projectId, data, ...opts } as BusEntry;

  const hooks = c.get('postCommitHooks');
  // A separate hook from the webhook flush below: the runner catches each hook
  // independently, so an enqueue failure can never suppress the publish.
  hooks.push(async () => {
    publish(entry);
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

  if (!isWebhookEnvelope(entry)) {
    return;
  }
  // A post-commit hook rather than a bus subscriber: with Redis every replica
  // sees every entry through the subscription echo, so a subscriber would
  // enqueue one copy per replica.
  const pending = c.get('webhookEvents');
  if (pending.length === 0) {
    hooks.push(() => enqueueDeliveries(pending));
  }
  // The whole entry, publish options included: only the correlated value carries
  // a payload the compiler can still match to its type. Nothing leaks, because
  // enqueueDeliveries builds the delivered body field by field.
  pending.push(entry);
}
