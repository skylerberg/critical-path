import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import UnsyncedChangesPanel from './UnsyncedChangesPanel.svelte';
import { board } from '../lib/board.svelte';
import { conflictDrafts } from '../lib/conflictDrafts.svelte';
import { connectivity } from '../lib/connectivity.svelte';
import { outbox, STALE_QUEUE_WARNING_MS, type SubmitInput } from '../lib/outbox.svelte';
import { resetConnectionForTests } from '../lib/offline-db';
import { session } from '../lib/session.svelte';
import { taskHref } from '../lib/short-links';
import { testUuid } from '../lib/test-ids';
import type { BoardTask } from '../lib/board-types';

const PROJECT_ID = testUuid('p1');
const ON_BOARD_ID = testUuid('t1');
const ELSEWHERE_ID = testUuid('t2');

const user = {
  id: testUuid('u1'),
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: true,
};

function task(id: string, title: string): BoardTask {
  return {
    id,
    column_id: 'c1',
    title,
    description: null,
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    attachment_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
  };
}

function edit(taskId: string, label: string): SubmitInput {
  return {
    projectId: PROJECT_ID,
    entityId: taskId,
    label,
    request: { method: 'PATCH', path: '/api/tasks/{id}', pathParams: { id: taskId }, body: {} },
  };
}

function unreachable(): void {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
}

// Raised through the drain rather than reached into: `issues` is private, and an
// issue the outbox did not file is not the shape the panel reads.
async function raiseConflict(taskId: string, label: string): Promise<void> {
  unreachable();
  await outbox.submit({
    ...edit(taskId, label),
    semantics: 'contentEdit',
    conflict: {
      taskId,
      base: { title: 'old', description: null },
      mine: { title: 'mine', description: null },
    },
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(jsonResponse(409, { error: 'This task changed since you loaded it' }))
  );
  await outbox.drain();
}

function panel(): void {
  render(UnsyncedChangesPanel, { props: { open: true, onclose: vi.fn() } });
}

beforeEach(async () => {
  fetchMock.mockReset();
  localStorage.clear();
  conflictDrafts.clearAll();
  outbox.reset();
  board.reset();
  connectivity.resetForTests();
  await resetConnectionForTests();
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', user }));
  await session.login(user.email, 'password123');
  fetchMock.mockReset();
  outbox.retryDelayMs = 0;
  outbox.wakeDelayMs = 60_000;
  board.currentProjectId = PROJECT_ID;
  board.tasks = [task(ON_BOARD_ID, 'Design cards')];
});

afterEach(() => {
  vi.useRealTimers();
  outbox.reset();
  session.user = null;
});

describe('UnsyncedChangesPanel', () => {
  it('lists what is still waiting to be sent', async () => {
    unreachable();
    await outbox.submit(edit(ON_BOARD_ID, 'Renamed a card'));
    await outbox.submit(edit(ELSEWHERE_ID, 'Moved a card'));

    panel();

    expect(screen.getByRole('heading', { name: 'Waiting to send (2)' })).toBeInTheDocument();
    expect(screen.getAllByTestId('pending-change')).toHaveLength(2);
    expect(screen.getByText('Renamed a card')).toBeInTheDocument();
    expect(screen.getByText('Moved a card')).toBeInTheDocument();
  });

  it('says the queue is empty rather than showing an empty list', () => {
    panel();

    expect(screen.getByRole('heading', { name: 'Waiting to send (0)' })).toBeInTheDocument();
    expect(screen.queryAllByTestId('pending-change')).toEqual([]);
    expect(
      screen.getByText('Nothing is waiting. Everything you have changed has been sent.')
    ).toBeInTheDocument();
  });

  it('warns when the oldest change has been waiting more than a day', async () => {
    // Date alone: faking setTimeout as well leaves the offline database's own
    // requests waiting on a clock this test then puts back.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() - STALE_QUEUE_WARNING_MS - 60_000));
    unreachable();
    await outbox.submit(edit(ON_BOARD_ID, 'Renamed a card'));
    vi.useRealTimers();

    panel();

    expect(screen.getByTestId('stale-queue-warning')).toBeInTheDocument();
  });

  it('leaves the warning off a queue that has only just filled', async () => {
    unreachable();
    await outbox.submit(edit(ON_BOARD_ID, 'Renamed a card'));

    panel();

    expect(screen.queryByTestId('stale-queue-warning')).toBeNull();
  });

  // The card is where the resolution UI lives, with the user's version already
  // in it; a conflict on a card this board does not hold has nowhere to send them.
  it('offers the card as the way to merge a conflict it can find', async () => {
    await raiseConflict(ON_BOARD_ID, 'Renamed a card');

    panel();

    expect(screen.getByRole('link', { name: 'Open the card to merge' })).toHaveAttribute(
      'href',
      taskHref(ON_BOARD_ID, 'Design cards')
    );
  });

  it('offers no link for a conflict on a card the board does not hold', async () => {
    await raiseConflict(ELSEWHERE_ID, 'Renamed a card');

    panel();

    expect(screen.getByTestId('outbox-issue')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open the card to merge' })).toBeNull();
  });

  it('dismisses only the issue whose button was pressed', async () => {
    await raiseConflict(ON_BOARD_ID, 'Renamed a card');
    await raiseConflict(ELSEWHERE_ID, 'Moved a card');

    panel();
    const first = screen.getAllByTestId('outbox-issue')[0]!;
    await fireEvent.click(within(first).getByRole('button', { name: 'Dismiss' }));

    expect(screen.getAllByTestId('outbox-issue')).toHaveLength(1);
    expect(screen.getByText('Moved a card')).toBeInTheDocument();
    expect(screen.queryByText('Renamed a card')).toBeNull();
    expect(outbox.issues).toHaveLength(1);
  });

  it('clears every issue from the footer', async () => {
    await raiseConflict(ON_BOARD_ID, 'Renamed a card');
    await raiseConflict(ELSEWHERE_ID, 'Moved a card');

    panel();
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));

    expect(screen.queryAllByTestId('outbox-issue')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull();
    expect(outbox.issues).toEqual([]);
  });

  it('says when the board itself was last read', () => {
    board.syncedAt = '2026-01-01T00:00:00Z';

    panel();

    expect(screen.getByText(/This board was last read from the server/)).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-01-01T00:00:00Z');
  });
});
