import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import SyncStatus from './SyncStatus.svelte';
import { realtime } from '../lib/realtime.svelte';
import { session } from '../lib/session.svelte';

// `syncState` is tested as a pure function and `realtime.evicted` is tested on the
// store, but the wire between them is one property in this component's `$derived`.
// Replacing it with a literal `false` compiles, typechecks and passes every other
// test in the repo while the whole user-visible half of the eviction notice goes
// quiet, so this is the only place that failure can be caught.

function status(): HTMLElement | null {
  return screen.queryByTestId('sync-status');
}

beforeEach(() => {
  session.user = null;
  session.status = 'authed';
  realtime.evicted = false;
  realtime.interrupted = false;
});

afterEach(() => {
  session.status = 'unknown';
  realtime.evicted = false;
  realtime.interrupted = false;
});

describe('SyncStatus', () => {
  it('says why live updates stopped when the account is out of slots', () => {
    realtime.evicted = true;

    render(SyncStatus);

    expect(status()).toHaveAttribute('data-state', 'evicted');
    expect(status()).toHaveTextContent(
      'Live updates paused — this account has too many open connections'
    );
  });

  it('says nothing while the socket is healthy', () => {
    render(SyncStatus);

    expect(status()).toBeNull();
  });

  it('does not blame the ceiling for an ordinary interruption', () => {
    realtime.interrupted = true;

    render(SyncStatus);

    expect(status()).toHaveAttribute('data-state', 'reconnecting');
  });
});
