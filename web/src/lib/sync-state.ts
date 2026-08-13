import { STALE_QUEUE_WARNING_MS } from './outbox.svelte';

export type SyncState =
  /** Nothing waiting, nothing wrong. The indicator is not shown at all. */
  | 'clean'
  /** Reachable, and the queue is going out now. */
  | 'syncing'
  /** Reachable, with work queued behind the wait before the next attempt. */
  | 'pending'
  /** Unreachable, with the user's work waiting on this device. */
  | 'offline-pending'
  /** Unreachable, nothing waiting. Reads are coming from the last snapshot. */
  | 'offline'
  /** The server is up, but the last refresh did not land, so reads are behind. */
  | 'stale'
  /** HTTP works; only the live-updates socket is down. Weakest of the states. */
  | 'reconnecting'
  /** Everything that could be sent has been, and some of it did not land. */
  | 'needs-attention';

export interface SyncInputs {
  reachable: boolean;
  pendingCount: number;
  draining: boolean;
  socketInterrupted: boolean;
  unresolvedIssues: number;
  staleRead: boolean;
}

/**
 * One state out of five signals that each know only part of the story, ordered
 * so the most consequential thing true right now is the thing shown. Unsent work
 * outranks a dropped socket, because one is the user's writing and the other is
 * only how fast they see someone else's.
 *
 * `staleRead` sits above the socket for the same reason: a refresh that did not
 * land means what is on screen may already be wrong, which is worse than knowing
 * future changes will arrive late. It sits below `reachable`, because "Offline"
 * says all of this and says why.
 */
export function syncState(inputs: SyncInputs): SyncState {
  if (inputs.pendingCount > 0) {
    if (!inputs.reachable) {
      return 'offline-pending';
    }
    // Reachable with a queue that is not moving is a real state and not an
    // offline one: the drain backs off to minutes between attempts, so the gap
    // outlives the outage that opened it. Saying "Offline" through it names the
    // wrong problem, and "Sending" would name work that is not going out.
    return inputs.draining ? 'syncing' : 'pending';
  }
  if (!inputs.reachable) {
    return 'offline';
  }
  if (inputs.unresolvedIssues > 0) {
    return 'needs-attention';
  }
  if (inputs.staleRead) {
    return 'stale';
  }
  return inputs.socketInterrupted ? 'reconnecting' : 'clean';
}

/**
 * Deliberately plain about what is and is not true.
 *
 * "Saved" is never used for something still queued — it is exactly the claim
 * this feature must not make — and neither is "local-first", which would promise
 * an app designed to run offline indefinitely rather than one degrading
 * gracefully until the network returns.
 *
 * "Offline" is reserved for the states that mean it. Most of these arise only
 * while the server is answering, and naming one of them offline sends someone
 * looking at their signal for a problem that is not there — which is what
 * `reconnecting` did, saying "Offline" for the one state whose whole definition
 * is that HTTP works. The test beside this holds every reachable state to it,
 * and derives that list by round-tripping rather than restating it.
 */
export function syncMessage(state: SyncState, pendingCount: number, issues: number): string {
  const changes = `${String(pendingCount)} ${pendingCount === 1 ? 'change' : 'changes'}`;
  switch (state) {
    case 'syncing':
      return `Sending ${changes}…`;
    case 'pending':
      return `${changes} waiting to send`;
    case 'offline-pending':
      return `Offline — ${changes} waiting on this device`;
    case 'offline':
      return 'Offline — showing the last version on this device';
    case 'stale':
      return 'Could not refresh — showing an older version';
    case 'reconnecting':
      return 'Live updates paused — reconnecting';
    case 'needs-attention':
      return `${String(issues)} ${issues === 1 ? 'change needs' : 'changes need'} your attention`;
    case 'clean':
      return '';
  }
}

// Sitting unsent long enough that the user should be told plainly rather than
// left to infer it from a spinner that has been up since yesterday.
export function isQueueStale(oldestQueuedAt: string | null, now: number = Date.now()): boolean {
  if (oldestQueuedAt === null) {
    return false;
  }
  const queuedAt = Date.parse(oldestQueuedAt);
  return !Number.isNaN(queuedAt) && now - queuedAt >= STALE_QUEUE_WARNING_MS;
}
