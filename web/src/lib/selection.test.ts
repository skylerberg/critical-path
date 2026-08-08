import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_SELECTION, nextSelection, selection } from './selection.svelte';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';
import { session } from './session.svelte';
import { toasts } from './toasts.svelte';

describe('nextSelection', () => {
  const grid = [['a1', 'a2', 'a3'], ['b1'], [], ['d1', 'd2']];

  it('returns null for an empty board', () => {
    expect(nextSelection([], null, 'down')).toBeNull();
    expect(nextSelection([[], []], null, 'down')).toBeNull();
  });

  it('selects the first task when nothing is selected', () => {
    expect(nextSelection(grid, null, 'down')).toBe('a1');
    expect(nextSelection(grid, null, 'up')).toBe('a1');
    expect(nextSelection(grid, 'missing', 'right')).toBe('a1');
  });

  it('moves down and up within a column, clamping at the ends', () => {
    expect(nextSelection(grid, 'a1', 'down')).toBe('a2');
    expect(nextSelection(grid, 'a3', 'down')).toBe('a3');
    expect(nextSelection(grid, 'a2', 'up')).toBe('a1');
    expect(nextSelection(grid, 'a1', 'up')).toBe('a1');
  });

  it('moves to the nearest row of the adjacent non-empty column', () => {
    expect(nextSelection(grid, 'a1', 'right')).toBe('b1');
    expect(nextSelection(grid, 'a3', 'right')).toBe('b1');
    expect(nextSelection(grid, 'd2', 'left')).toBe('b1');
  });

  it('skips empty columns when moving horizontally', () => {
    expect(nextSelection(grid, 'b1', 'right')).toBe('d1');
    expect(nextSelection(grid, 'a2', 'right')).toBe('b1');
  });

  it('stays put when there is no column in the given direction', () => {
    expect(nextSelection(grid, 'a1', 'left')).toBe('a1');
    expect(nextSelection(grid, 'd1', 'right')).toBe('d1');
  });
});

const ME = 'u-me';

function task(id: string, columnId: string, position: number): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
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

function makeEditable(createdBy: string | null = ME): void {
  board.project = {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: createdBy,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('selection store', () => {
  beforeEach(() => {
    board.reset();
    selection.clear();
    session.user = {
      id: ME,
      name: 'Ada',
      email: 'ada@example.com',
      avatar_url: null,
      email_verified: false,
    };
    for (const toast of [...toasts.toasts]) {
      toasts.dismiss(toast.id);
    }
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Doing', sort_key: 'V0000020001', is_done: false },
    ];
    board.tasks = [task('t1', 'c1', 1000), task('t2', 'c1', 2000), task('t3', 'c2', 1000)];
    makeEditable();
  });

  describe('cursor', () => {
    it('navigates against the live board and reports the cursor column', () => {
      selection.move('down');
      expect(selection.cursorTaskId).toBe('t1');
      expect(selection.cursorColumnId).toBe('c1');

      selection.move('down');
      expect(selection.cursorTaskId).toBe('t2');

      selection.move('right');
      expect(selection.cursorTaskId).toBe('t3');
      expect(selection.cursorColumnId).toBe('c2');
    });

    it('orders tasks within a column by position, not insertion order', () => {
      board.tasks = [task('t2', 'c1', 2000), task('t1', 'c1', 1000)];
      selection.move('down');
      expect(selection.cursorTaskId).toBe('t1');
    });

    it('moving the cursor leaves the set alone', () => {
      selection.toggle('t1');
      selection.move('down');

      expect(selection.cursorTaskId).toBe('t2');
      expect(selection.selectedIds).toEqual(['t1']);
    });

    function seedFilteredBoard(): void {
      board.tasks = [
        { ...task('t1', 'c1', 1000), title: 'plain one' },
        { ...task('t2', 'c1', 2000), title: 'match a' },
        { ...task('t3', 'c1', 3000), title: 'match b' },
        { ...task('t4', 'c2', 1000), title: 'plain two' },
        { ...task('t5', 'c2', 2000), title: 'match c' },
      ];
      board.setFilterQuery('match');
    }

    it('walks matched tasks before dimmed ones when filters are active', () => {
      seedFilteredBoard();

      selection.move('down');
      expect(selection.cursorTaskId).toBe('t2');
      selection.move('down');
      expect(selection.cursorTaskId).toBe('t3');
      selection.move('down');
      expect(selection.cursorTaskId).toBe('t1');
    });

    it('moves horizontally by display row, landing on a dimmed task when rows differ', () => {
      seedFilteredBoard();

      selection.set('t3');
      selection.move('right');
      expect(selection.cursorTaskId).toBe('t4');
    });

    it('hovering sets the cursor and never the set', () => {
      selection.set('t2');

      expect(selection.cursorTaskId).toBe('t2');
      expect(selection.count).toBe(0);
    });
  });

  describe('toggle', () => {
    it('adds and removes, keeping board order regardless of click order', () => {
      selection.toggle('t2');
      selection.toggle('t1');
      expect(selection.selectedIds).toEqual(['t1', 't2']);
      expect(selection.count).toBe(2);
      expect(selection.has('t1')).toBe(true);

      selection.toggle('t1');
      expect(selection.selectedIds).toEqual(['t2']);
      expect(selection.has('t1')).toBe(false);
      expect(selection.cursorTaskId).toBe('t1');
    });

    it('spans columns', () => {
      selection.toggle('t1');
      selection.toggle('t3');

      expect(selection.selectedIds).toEqual(['t1', 't3']);
    });
  });

  describe('extendTo', () => {
    it('selects the run between the anchor and the target', () => {
      board.tasks = [
        task('t1', 'c1', 1000),
        task('t2', 'c1', 2000),
        task('t3', 'c1', 3000),
        task('t4', 'c1', 4000),
      ];
      selection.toggle('t2');

      selection.extendTo('t4');

      expect(selection.selectedIds).toEqual(['t2', 't3', 't4']);
      expect(selection.cursorTaskId).toBe('t4');
    });

    it('walks display order under an active filter, not position order', () => {
      board.tasks = [
        { ...task('t1', 'c1', 1000), title: 'plain one' },
        { ...task('t2', 'c1', 2000), title: 'match a' },
        { ...task('t3', 'c1', 3000), title: 'match b' },
      ];
      board.setFilterQuery('match');
      selection.toggle('t2');

      selection.extendTo('t1');

      // Display order is t2, t3, t1 — so the run to t1 is the whole column.
      expect(selection.selectedIds).toEqual(['t1', 't2', 't3']);
    });

    it('re-anchors like a toggle when the target is in another column', () => {
      selection.toggle('t1');

      selection.extendTo('t3');

      expect(selection.selectedIds).toEqual(['t1', 't3']);
      expect(selection.cursorTaskId).toBe('t3');
    });

    it('toggles when there is no anchor', () => {
      selection.extendTo('t2');

      expect(selection.selectedIds).toEqual(['t2']);
    });
  });

  describe('extend by keyboard', () => {
    beforeEach(() => {
      board.tasks = [
        task('t1', 'c1', 1000),
        task('t2', 'c1', 2000),
        task('t3', 'c1', 3000),
        task('t4', 'c1', 4000),
        task('t5', 'c2', 1000),
      ];
    });

    it('grows downward and shrinks again on the way back up', () => {
      selection.set('t1');

      selection.extend('down');
      expect(selection.selectedIds).toEqual(['t1', 't2']);
      selection.extend('down');
      expect(selection.selectedIds).toEqual(['t1', 't2', 't3']);

      selection.extend('up');
      expect(selection.selectedIds).toEqual(['t1', 't2']);
      selection.extend('up');
      expect(selection.selectedIds).toEqual(['t1']);
      expect(selection.cursorTaskId).toBe('t1');
    });

    it('keeps what was already picked outside the run', () => {
      selection.toggle('t4');
      selection.move('up');
      selection.move('up');
      selection.move('up');

      selection.extend('down');

      expect(selection.selectedIds).toEqual(['t1', 't2', 't4']);
    });

    it('moves the cursor sideways without changing the set', () => {
      selection.toggle('t1');
      selection.extend('right');

      expect(selection.cursorTaskId).toBe('t5');
      expect(selection.selectedIds).toEqual(['t1']);
    });

    it('starts a fresh run after a plain move', () => {
      selection.set('t1');
      selection.extend('down');
      expect(selection.selectedIds).toEqual(['t1', 't2']);

      selection.move('down');
      selection.extend('down');

      expect(selection.selectedIds).toEqual(['t1', 't2', 't3', 't4']);
      expect(selection.cursorTaskId).toBe('t4');
    });

    it('picks the first card when there is no cursor yet', () => {
      selection.extend('down');

      expect(selection.cursorTaskId).toBe('t1');
      expect(selection.selectedIds).toEqual(['t1']);
    });

    it('re-anchors when hover has moved the cursor to another column', () => {
      board.tasks = [...board.tasks, task('t6', 'c2', 2000)];
      selection.toggle('t1');
      selection.set('t5');

      selection.extend('down');

      expect(selection.cursorTaskId).toBe('t6');
      expect(selection.selectedIds).toEqual(['t1', 't5', 't6']);
    });
  });

  describe('surviving realtime', () => {
    it('drops a card that leaves the board, silently', () => {
      selection.toggle('t1');
      selection.toggle('t2');

      board.tasks = board.tasks.filter((t) => t.id !== 't1');

      expect(selection.selectedIds).toEqual(['t2']);
      expect(selection.count).toBe(1);
      expect(selection.has('t1')).toBe(false);
      expect(selection.targetsFor('t2')).toEqual(['t2']);
    });

    it('keeps a card that only moves column', () => {
      selection.toggle('t1');

      board.tasks = board.tasks.map((t) => (t.id === 't1' ? { ...t, column_id: 'c2' } : t));

      expect(selection.selectedIds).toEqual(['t1']);
    });
  });

  describe('targetsFor', () => {
    it('returns the whole set for a member and the card alone for a stranger', () => {
      selection.toggle('t1');
      selection.toggle('t2');

      expect(selection.targetsFor('t1')).toEqual(['t1', 't2']);
      expect(selection.targetsFor('t3')).toEqual(['t3']);
      expect(selection.targetsFor(null)).toEqual([]);
    });
  });

  describe('activate', () => {
    it('keeps a set it lands inside', () => {
      selection.toggle('t1');
      selection.toggle('t2');

      selection.activate('t2');

      expect(selection.selectedIds).toEqual(['t1', 't2']);
      expect(selection.cursorTaskId).toBe('t2');
    });

    it('collapses a set it lands outside', () => {
      selection.toggle('t1');

      selection.activate('t3');

      expect(selection.selectedIds).toEqual([]);
      expect(selection.cursorTaskId).toBe('t3');
    });
  });

  describe('clear', () => {
    it('clears the set and the cursor together', () => {
      selection.toggle('t1');
      selection.set('t2');

      selection.clear();

      expect(selection.cursorTaskId).toBeNull();
      expect(selection.selectedIds).toEqual([]);
    });
  });

  describe('cap', () => {
    it('truncates to the first hundred in board order and says so', () => {
      board.tasks = Array.from({ length: MAX_SELECTION + 5 }, (_, i) =>
        task(`b${String(i)}`, 'c1', (i + 1) * 1000)
      );
      selection.set('b0');

      for (let i = 0; i < MAX_SELECTION + 4; i++) {
        selection.extend('down');
      }

      expect(selection.count).toBe(MAX_SELECTION);
      expect(selection.selectedIds[0]).toBe('b0');
      expect(selection.has(`b${String(MAX_SELECTION)}`)).toBe(false);
      // Once for the run, not once per press past the cap.
      expect(toasts.toasts.map((t) => t.message)).toEqual([
        `You can select at most ${String(MAX_SELECTION)} cards at a time`,
      ]);
    });
  });

  describe('read-only boards', () => {
    beforeEach(() => {
      makeEditable(null);
    });

    it('no-ops every set mutator but still moves the cursor', () => {
      selection.toggle('t1');
      selection.extendTo('t2');

      expect(selection.selectedIds).toEqual([]);

      selection.extend('down');
      expect(selection.cursorTaskId).toBe('t1');
      selection.extend('down');
      expect(selection.cursorTaskId).toBe('t2');
      expect(selection.selectedIds).toEqual([]);
    });
  });
});
