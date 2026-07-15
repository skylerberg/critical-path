import type { AppContext } from '../../types/index';

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
  // Deliver to current members of this workspace (live membership check).
  workspaceId?: string;
}

export interface BusEntry extends RealtimeEnvelope, PublishOptions {}

export type BusSubscriber = (entry: BusEntry) => void;

export const SESSIONS_REVOKED = 'sessions_revoked';

const subscribers = new Set<BusSubscriber>();

// Single publish entry point; a Redis-backed bus swaps in behind the same
// publish/subscribe pair.
export function publish(entry: BusEntry): void {
  for (const subscriber of subscribers) {
    subscriber(entry);
  }
}

export function subscribeBus(subscriber: BusSubscriber): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

export function resetBus(): void {
  subscribers.clear();
}

export function publishAfterCommit(
  c: Pick<AppContext, 'get'>,
  type: string,
  projectId: string | null,
  data: unknown,
  opts?: PublishOptions
): void {
  c.get('postCommitHooks').push(async () => {
    publish({ type, project_id: projectId, data, ...opts });
  });
}
