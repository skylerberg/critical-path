import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardAnnouncer } from './board-announcer.svelte';
import { board } from './board.svelte';
import type { BoardColumn, BoardTask } from './board-types';
import { realtimeEvent } from './realtime-test-events';
import type { RealtimeEvent } from './realtime-types';
import { router } from './router.svelte';
import { session } from './session.svelte';
import { projectHref, taskHref } from './short-links';
import { testUuid } from './test-ids';
import { users } from './users.svelte';

const PROJECT = testUuid('p1');
const ME = 'u-me';
const THEM = 'u-them';
const TODO = 'c-todo';
const DONE = 'c-done';

function task(id: string, columnId = TODO, title = 'Ship it'): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    sort_key: 'V000010001',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    column_since: '2026-08-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function column(id: string, name: string, isDone = false): BoardColumn {
  return { id, name, sort_key: id === TODO ? 'V0' : 'V1', is_done: isDone };
}

function moved(id: string, columnId: string) {
  return { id, column_id: columnId, sort_key: 'V000020001' };
}

/** Records the event and drains the announce window. */
async function fire(...events: RealtimeEvent[]): Promise<void> {
  for (const event of events) {
    boardAnnouncer.record(event);
  }
  await vi.advanceTimersByTimeAsync(1500);
}

function theirs<T extends RealtimeEvent['type']>(
  type: T,
  data: Record<string, unknown>,
  actorId = THEM
): RealtimeEvent {
  return realtimeEvent(type, { ...data, actor_user_id: actorId } as never, PROJECT);
}

beforeEach(() => {
  vi.useFakeTimers();
  board.reset();
  boardAnnouncer.reset();
  users.reset();
  session.user = {
    id: ME,
    name: 'Ada',
    email: 'ada@example.com',
    email_verified: true,
    avatar_url: null,
  };
  users.users = [{ id: THEM, name: 'Ana', avatar_url: null }];
  board.currentProjectId = PROJECT;
  board.columns = [column(TODO, 'To Do'), column(DONE, 'Done', true)];
  board.tasks = [];
  router.navigate(projectHref(PROJECT, 'Rulebook'), { replace: true });
});

afterEach(() => {
  boardAnnouncer.reset();
  vi.useRealTimers();
});

describe('announcing a teammate’s board changes', () => {
  it('names a single created card', async () => {
    await fire(theirs('task_created', task('t1')));

    expect(boardAnnouncer.message).toBe('Ana added "Ship it"');
  });

  it('counts a move burst that landed in one column', async () => {
    board.tasks = [task('t1', TODO, 'A'), task('t2', TODO, 'B'), task('t3', TODO, 'C')];

    await fire(
      theirs('column_tasks_moved', {
        column_id: TODO,
        target_column_id: DONE,
        moved_tasks: [moved('t1', DONE), moved('t2', DONE), moved('t3', DONE)],
      })
    );

    expect(boardAnnouncer.message).toBe('Ana moved 3 cards to Done');
  });

  it('drops the destination when one batch landed in two columns', async () => {
    board.columns = [...board.columns, column('c-other', 'Backlog')];
    board.tasks = [task('t1', TODO, 'A'), task('t2', TODO, 'B')];

    await fire(
      theirs('bulk_tasks_moved', { moved_tasks: [moved('t1', DONE), moved('t2', 'c-other')] })
    );

    expect(boardAnnouncer.message).toBe('Ana moved 2 cards');
  });

  it('joins a mixed batch into counted clauses and names no title', async () => {
    board.tasks = [task('t3', TODO, 'Old')];

    await fire(
      theirs('task_created', task('t1', TODO, 'A')),
      theirs('task_created', task('t2', TODO, 'B')),
      theirs('task_archived', { ...task('t3', TODO, 'Old'), archived_at: '2026-08-01T00:00:00Z' })
    );

    expect(boardAnnouncer.message).toBe('Ana added 2 cards, archived 1 card');
  });

  it('falls back to a count when the burst spans two people', async () => {
    users.users = [...users.users, { id: 'u-cy', name: 'Cy', avatar_url: null }];

    await fire(
      theirs('task_created', task('t1', TODO, 'A')),
      theirs('task_created', task('t2', TODO, 'B')),
      theirs('task_created', task('t3', TODO, 'C'), 'u-cy'),
      theirs('task_created', task('t4', TODO, 'D'), 'u-cy')
    );

    expect(boardAnnouncer.message).toBe('2 people made 4 changes');
  });

  it('names a new column', async () => {
    await fire(theirs('column_created', column('c-new', 'Review')));

    expect(boardAnnouncer.message).toBe('Ana added the Review column');
  });

  // The payload carries no name, so this can only pass if record() read the
  // column out of the store before applyRealtime removed it.
  it('names a deleted column from the board it is about to leave', async () => {
    await fire(theirs('column_deleted', { id: DONE, moved_tasks: [] }));

    expect(boardAnnouncer.message).toBe('Ana deleted the Done column');
  });

  // Same, for a payload that is only an id.
  it('names a deleted card from the board it is about to leave', async () => {
    board.tasks = [task('t1', TODO, 'Ship it')];

    await fire(theirs('task_deleted', { id: 't1' }));

    expect(boardAnnouncer.message).toBe('Ana deleted "Ship it"');
  });

  it('says nothing about the reader’s own change', async () => {
    await fire(theirs('task_created', task('t1'), ME));

    expect(boardAnnouncer.message).toBe('');
  });

  it('says nothing when the event names no actor', async () => {
    await fire(realtimeEvent('task_created', task('t1'), PROJECT));
    await fire(theirs('task_created', task('t2'), null as unknown as string));

    expect(boardAnnouncer.message).toBe('');
  });

  it('says nothing about a reorder within one column', async () => {
    board.tasks = [task('t1', TODO, 'A')];

    await fire(
      theirs('column_tasks_moved', {
        column_id: TODO,
        target_column_id: TODO,
        moved_tasks: [moved('t1', TODO)],
      })
    );

    expect(boardAnnouncer.message).toBe('');
  });

  it('stays silent for the event types held back from the running commentary', async () => {
    board.tasks = [task('t1', TODO, 'A')];

    await fire(
      theirs('task_updated', { ...task('t1', TODO, 'Renamed') }),
      theirs('column_tasks_reordered', { column_id: TODO, moved_tasks: [moved('t1', TODO)] }),
      theirs('column_updated', column(TODO, 'Doing')),
      theirs('comment_created', { id: 'cm1', task_id: 't1', comment_count: 1 }),
      theirs('label_created', { id: 'l1', name: 'Urgent', color: '#ef4444' })
    );

    expect(boardAnnouncer.message).toBe('');
  });

  it('says nothing about a card the board does not hold', async () => {
    await fire(
      theirs('task_archived', {
        ...task('gone', TODO, 'Gone'),
        archived_at: '2026-08-01T00:00:00Z',
      })
    );

    expect(boardAnnouncer.message).toBe('');
  });

  it('says nothing when a create is an echo of a card already held', async () => {
    board.tasks = [task('t1')];

    await fire(theirs('task_created', task('t1')));

    expect(boardAnnouncer.message).toBe('');
  });

  it('gives one sentence per window, and opens a new window after it flushes', async () => {
    boardAnnouncer.record(theirs('task_created', task('t1', TODO, 'A')));
    await vi.advanceTimersByTimeAsync(1400);
    boardAnnouncer.record(theirs('task_created', task('t2', TODO, 'B')));
    await vi.advanceTimersByTimeAsync(100);

    expect(boardAnnouncer.message).toBe('Ana added 2 cards');

    await fire(theirs('task_created', task('t3', TODO, 'C')));
    expect(boardAnnouncer.message).toBe('Ana added "C"');
  });

  // A debounce would starve here: a teammate moving a card a second would keep
  // pushing the flush out and never say anything.
  it('does not extend the window when changes keep arriving', async () => {
    boardAnnouncer.record(theirs('task_created', task('t1', TODO, 'A')));
    await vi.advanceTimersByTimeAsync(800);
    boardAnnouncer.record(theirs('task_created', task('t2', TODO, 'B')));
    await vi.advanceTimersByTimeAsync(600);
    boardAnnouncer.record(theirs('task_created', task('t3', TODO, 'C')));
    await vi.advanceTimersByTimeAsync(100);

    expect(boardAnnouncer.message).toBe('Ana added 3 cards');
  });

  it('drops the sentence while a dialog is open, and keeps the tint', async () => {
    document.body.innerHTML = '<dialog open></dialog>';
    try {
      await fire(theirs('task_created', task('t1')));

      expect(boardAnnouncer.message).toBe('');
      expect(board.changedTaskIds.has('t1')).toBe(true);
    } finally {
      document.body.innerHTML = '';
    }
  });

  it('drops the sentence off a project route, and keeps the tint', async () => {
    router.navigate('/my-tasks', { replace: true });

    await fire(theirs('task_created', task('t1')));

    expect(boardAnnouncer.message).toBe('');
    expect(board.changedTaskIds.has('t1')).toBe(true);
  });

  it('cancels a pending flush on reset', async () => {
    boardAnnouncer.record(theirs('task_created', task('t1')));
    boardAnnouncer.reset();

    await vi.advanceTimersByTimeAsync(1500);

    expect(boardAnnouncer.message).toBe('');
  });

  it('says nothing on a board the reader may not edit', async () => {
    board.readonly = true;

    await fire(theirs('task_created', task('t1')));

    expect(boardAnnouncer.message).toBe('');
    expect(board.changedTaskIds.has('t1')).toBe(false);
  });

  it('blanks between identical sentences so a repeat is read again', async () => {
    await fire(theirs('task_created', task('t1', TODO, 'Ship it')));
    expect(boardAnnouncer.message).toBe('Ana added "Ship it"');

    boardAnnouncer.record(theirs('task_created', task('t2', TODO, 'Ship it')));
    await vi.advanceTimersByTimeAsync(1500);
    expect(boardAnnouncer.message).toBe('Ana added "Ship it"');
  });

  it('names an actor it cannot resolve rather than rendering a blank', async () => {
    users.reset();

    await fire(theirs('task_created', task('t1')));

    expect(boardAnnouncer.message).toBe('Unknown user added "Ship it"');
  });
});

describe('tinting the cards a teammate touched', () => {
  it('tints created and cross-column-moved cards, but not ones that left the board', async () => {
    board.tasks = [task('t2', TODO, 'B')];

    await fire(
      theirs('task_created', task('t1', TODO, 'A')),
      theirs('column_tasks_moved', {
        column_id: TODO,
        target_column_id: DONE,
        moved_tasks: [moved('t2', DONE)],
      }),
      theirs('task_deleted', { id: 't2' })
    );

    expect([...board.changedTaskIds].sort()).toEqual(['t1', 't2']);
  });

  it('never tints the card whose overlay is open', async () => {
    const open = testUuid('open');
    router.navigate(taskHref(open, 'Ship it'), { replace: true });

    await fire(theirs('task_created', task(open)), theirs('task_created', task('t2', TODO, 'B')));

    expect(board.changedTaskIds.has(open)).toBe(false);
    expect(board.changedTaskIds.has('t2')).toBe(true);
  });

  // Opening a card earlier in this visit is no reason to hide that a teammate has
  // changed it since — which is where this parts company with the entry capture.
  it('re-tints a card the reader had already opened', async () => {
    board.tasks = [task('t1', TODO, 'A')];
    board.clearChanged('t1');

    await fire(
      theirs('column_tasks_moved', {
        column_id: TODO,
        target_column_id: DONE,
        moved_tasks: [moved('t1', DONE)],
      })
    );

    expect(board.changedTaskIds.has('t1')).toBe(true);
  });
});
