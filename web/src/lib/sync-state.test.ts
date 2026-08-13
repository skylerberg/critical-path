import { describe, expect, it } from 'vitest';
import {
  isQueueStale,
  syncMessage,
  syncState,
  type SyncInputs,
  type SyncState,
} from './sync-state';

function inputs(overrides: Partial<SyncInputs> = {}): SyncInputs {
  return {
    reachable: true,
    pendingCount: 0,
    draining: false,
    socketInterrupted: false,
    unresolvedIssues: 0,
    staleRead: false,
    ...overrides,
  };
}

// Inputs that produce `state` with the server answering. The test using this
// feeds each one back through syncState first, so a state that cannot in fact be
// reached this way fails there rather than having its message quietly asserted
// against the wrong condition.
function reaching(state: SyncState): SyncInputs {
  switch (state) {
    case 'syncing':
      return inputs({ pendingCount: 1, draining: true });
    case 'pending':
      return inputs({ pendingCount: 1 });
    case 'stale':
      return inputs({ staleRead: true });
    case 'reconnecting':
      return inputs({ socketInterrupted: true });
    case 'needs-attention':
      return inputs({ unresolvedIssues: 1 });
    default:
      throw new Error(`${state} does not happen while the server is answering`);
  }
}

describe('syncState', () => {
  it('shows nothing when there is nothing to say', () => {
    expect(syncState(inputs())).toBe('clean');
  });

  // Unsent work outranks a dropped socket: one is the user's writing, the other
  // is only how quickly they see someone else's.
  it('reports waiting work ahead of an interrupted socket', () => {
    expect(syncState(inputs({ reachable: false, pendingCount: 2, socketInterrupted: true }))).toBe(
      'offline-pending'
    );
  });

  it('distinguishes sending from waiting', () => {
    expect(syncState(inputs({ pendingCount: 1, draining: true }))).toBe('syncing');
    expect(syncState(inputs({ pendingCount: 1, draining: false, reachable: false }))).toBe(
      'offline-pending'
    );
  });

  // The drain backs off to minutes between attempts, so this gap outlives the
  // outage that opened it. Calling it "Offline" names a problem that has passed.
  it('does not call a queue waiting on a reachable server offline', () => {
    expect(syncState(inputs({ pendingCount: 1, draining: false, reachable: true }))).toBe(
      'pending'
    );
  });

  it('reports being offline with an empty queue', () => {
    expect(syncState(inputs({ reachable: false }))).toBe('offline');
  });

  it('surfaces unresolved issues once everything that could be sent has been', () => {
    expect(syncState(inputs({ unresolvedIssues: 1 }))).toBe('needs-attention');
  });

  // A read that did not land means what is on screen may already be wrong, which
  // is worse than knowing future changes will arrive late.
  it('reports a failed refresh ahead of an interrupted socket', () => {
    expect(syncState(inputs({ staleRead: true, socketInterrupted: true }))).toBe('stale');
  });

  // "Offline" already says the board is the last one this device saw, and says why.
  it('prefers offline over a failed refresh, and unsent work over both', () => {
    expect(syncState(inputs({ staleRead: true, reachable: false }))).toBe('offline');
    expect(syncState(inputs({ staleRead: true, pendingCount: 1, reachable: false }))).toBe(
      'offline-pending'
    );
    expect(syncState(inputs({ staleRead: true, pendingCount: 1 }))).toBe('pending');
  });

  it('falls back to the socket only when nothing else is true', () => {
    expect(syncState(inputs({ socketInterrupted: true }))).toBe('reconnecting');
  });
});

describe('syncMessage', () => {
  // The whole point of the indicator: it must not imply a save that has not
  // happened, and it must not claim the app works offline indefinitely.
  it('never describes queued work as saved, or the app as local-first', () => {
    const messages = [
      syncMessage('syncing', 2, 0),
      syncMessage('pending', 2, 0),
      syncMessage('offline-pending', 2, 0),
      syncMessage('offline', 0, 0),
      syncMessage('reconnecting', 0, 0),
      syncMessage('stale', 0, 0),
      syncMessage('needs-attention', 0, 3),
    ];
    for (const message of messages) {
      expect(message.toLowerCase()).not.toContain('saved');
      expect(message.toLowerCase()).not.toContain('local-first');
    }
  });

  // The states below are only ever produced with `reachable: true`, so calling
  // any of them offline sends someone looking at their signal for a problem that
  // is not there. `reconnecting` is the one this caught: its whole definition is
  // that HTTP works, and it said "Offline" for a year.
  it('never calls a state offline that only happens while the server answers', () => {
    const whileReachable: SyncState[] = [
      'syncing',
      'pending',
      'stale',
      'reconnecting',
      'needs-attention',
    ];
    for (const state of whileReachable) {
      expect(syncState(reaching(state))).toBe(state);
      expect(syncMessage(state, 2, 3).toLowerCase()).not.toContain('offline');
    }
  });

  it('says what a dropped socket actually costs', () => {
    expect(syncMessage('reconnecting', 0, 0)).toBe('Live updates paused — reconnecting');
  });

  it('says where unsent work actually is', () => {
    expect(syncMessage('offline-pending', 2, 0)).toBe('Offline — 2 changes waiting on this device');
    expect(syncMessage('offline-pending', 1, 0)).toBe('Offline — 1 change waiting on this device');
  });

  it('claims neither an outage nor a send in progress for a waiting queue', () => {
    expect(syncMessage('pending', 2, 0)).toBe('2 changes waiting to send');
    expect(syncMessage('pending', 1, 0)).toBe('1 change waiting to send');
  });

  it('does not pretend the shown board is current', () => {
    expect(syncMessage('offline', 0, 0)).toBe('Offline — showing the last version on this device');
    expect(syncMessage('stale', 0, 0)).toBe('Could not refresh — showing an older version');
  });
});

describe('isQueueStale', () => {
  const now = Date.parse('2026-08-07T12:00:00Z');

  it('is false with nothing waiting', () => {
    expect(isQueueStale(null, now)).toBe(false);
  });

  it('is false for work queued moments ago', () => {
    expect(isQueueStale('2026-08-07T11:30:00Z', now)).toBe(false);
  });

  it('is true once the oldest has been waiting more than a day', () => {
    expect(isQueueStale('2026-08-06T09:00:00Z', now)).toBe(true);
  });

  it('treats an unparseable timestamp as not stale rather than throwing', () => {
    expect(isQueueStale('not a date', now)).toBe(false);
  });
});
