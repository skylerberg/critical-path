import { describe, expect, it } from 'vitest';
import { isQueueStale, syncMessage, syncState, type SyncInputs } from './sync-state';

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
    expect(syncState(inputs({ staleRead: true, pendingCount: 1 }))).toBe('offline-pending');
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

  it('says where unsent work actually is', () => {
    expect(syncMessage('offline-pending', 2, 0)).toBe('Offline — 2 changes waiting on this device');
    expect(syncMessage('offline-pending', 1, 0)).toBe('Offline — 1 change waiting on this device');
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
