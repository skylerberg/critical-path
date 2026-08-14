import { fetchMock } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import SyncStatus from './SyncStatus.svelte';
import { board } from '../lib/board.svelte';
import { connectivity } from '../lib/connectivity.svelte';
import { outbox, type SubmitInput } from '../lib/outbox.svelte';
import { realtime } from '../lib/realtime.svelte';
import { session } from '../lib/session.svelte';
import { testUuid } from '../lib/test-ids';

// `syncState` is tested as a pure function and `realtime.evicted` is tested on the
// store, but the wire between them is one property in this component's `$derived`.
// Replacing it with a literal `false` compiles, typechecks and passes every other
// test in the repo while the whole user-visible half of the eviction notice goes
// quiet, so this is the only place that failure can be caught.

function status(): HTMLElement | null {
  return screen.queryByTestId('sync-status');
}

const TASK_ID = testUuid('t1');

function edit(label: string): SubmitInput {
  return {
    projectId: testUuid('p1'),
    entityId: TASK_ID,
    label,
    request: { method: 'PATCH', path: '/api/tasks/{id}', pathParams: { id: TASK_ID }, body: {} },
  };
}

// Queued the way the app queues: a request that never gets an answer is the only
// thing that separates being offline from being refused.
async function queue(label: string): Promise<void> {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
  await outbox.submit(edit(label));
  connectivity.resetForTests();
}

beforeEach(() => {
  fetchMock.mockReset();
  session.user = null;
  session.status = 'authed';
  realtime.evicted = false;
  realtime.interrupted = false;
  outbox.reset();
  outbox.wakeDelayMs = 60_000;
  board.reset();
  connectivity.resetForTests();
});

afterEach(() => {
  session.status = 'unknown';
  realtime.evicted = false;
  realtime.interrupted = false;
  outbox.reset();
  board.reset();
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

// Half of this component is the way into the queue, and a pill that reads
// correctly while opening nothing is the failure it cannot report on itself.
describe('SyncStatus details', () => {
  it('leaves the pill uninteractive while there is nothing to read', () => {
    realtime.interrupted = true;

    render(SyncStatus);

    expect(status()).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull();
  });

  it('offers the queue for reading once something is waiting in it', async () => {
    await queue('Renamed a card');

    render(SyncStatus);

    expect(status()).toHaveAttribute('data-state', 'pending');
    // A button cannot carry role="status", so the announcement moves to the region.
    expect(status()).toHaveAttribute('aria-live', 'polite');
    expect(status()).not.toHaveAttribute('role');
    expect(
      screen.getByRole('button', { name: '1 change waiting to send Details' })
    ).toBeInTheDocument();
  });

  it('opens the unsynced changes panel from Details', async () => {
    await queue('Renamed a card');

    render(SyncStatus);
    expect(screen.queryByRole('dialog', { name: 'Unsynced changes' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /Details/ }));

    expect(screen.getByRole('dialog', { name: 'Unsynced changes' })).toBeInTheDocument();
    expect(screen.getByText('Renamed a card')).toBeInTheDocument();
  });

  it('turns the marker red once a change has been refused', async () => {
    await queue('Renamed a card');
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 400 }));
    await outbox.drain();

    render(SyncStatus);

    expect(status()).toHaveAttribute('data-state', 'needs-attention');
    expect(status()).toHaveTextContent('1 change needs your attention');
    expect(status()?.querySelector('span[aria-hidden="true"]')?.className).toContain('bg-danger');
  });
});
