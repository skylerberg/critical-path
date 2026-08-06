import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortcuts } from './shortcuts.svelte';
import { selection } from './selection.svelte';
import { board } from './board.svelte';
import { router } from './router.svelte';
import { session } from './session.svelte';
import { projectHref, publicBoardHref, taskHref } from './short-links';
import { testUuid } from './test-ids';
import type { BoardTask } from './board-types';

const me = {
  id: 'u-me',
  name: 'Ada',
  email: 'ada@example.com',
  avatar_url: null,
  email_verified: false,
};
const PROJECT_ID = testUuid('p1');
const TASK_1 = testUuid('t1');
const TASK_2 = testUuid('t2');
const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
const GRAPH_PATH = projectHref(PROJECT_ID, 'Game', 'graph');
const TASK_PATH = taskHref(TASK_1, 'A');
const GRAPH_TASK_PATH = taskHref(TASK_1, 'A', 'graph');

function task(id: string, columnId: string, position: number, title = id): BoardTask {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, ...init });
  shortcuts.handleKeydown(event);
  return event;
}

beforeEach(() => {
  board.reset();
  selection.clear();
  shortcuts.reset();
  document.body.innerHTML = '';
  board.currentProjectId = PROJECT_ID;
  board.project = {
    id: PROJECT_ID,
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: me.id,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
  };
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, sort_key: 'V0000010001', is_done: false },
    { id: 'done', name: 'Done', position: 2000, sort_key: 'V0000020001', is_done: true },
  ];
  board.tasks = [task(TASK_1, 'c1', 1000, 'A'), task(TASK_2, 'c1', 2000, 'B')];
  board.labels = [{ id: 'lab', name: 'art', color: '#ff0000' }];
  // Navigating rather than assigning `current` keeps `router.path` in step, which the
  // store needs to rewrite the query string when a shortcut changes a filter.
  router.navigate(BOARD_PATH, { replace: true });
  session.user = me;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shortcut focus guards', () => {
  it('ignores events whose default was already prevented', () => {
    const event = new KeyboardEvent('keydown', { key: 'j', cancelable: true });
    event.preventDefault();
    shortcuts.handleKeydown(event);
    expect(selection.cursorTaskId).toBeNull();
  });

  it('ignores keys while a drag is active', () => {
    board.dragging = true;
    press('j');
    expect(selection.cursorTaskId).toBeNull();

    selection.set(TASK_1);
    const moved = press('m');
    expect(shortcuts.moveMenu).toBeNull();
    expect(moved.defaultPrevented).toBe(false);
  });

  it('ignores keys while a text field is focused', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    selection.set(TASK_1);
    press('j');
    expect(selection.cursorTaskId).toBe(TASK_1);
    const event = press('f');
    expect(shortcuts.filterFocusRequested).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    const capsF = press('F');
    expect(shortcuts.filterFocusRequested).toBe(false);
    expect(capsF.defaultPrevented).toBe(false);
    const typed = press('b');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(typed.defaultPrevented).toBe(false);
    const moved = press('m');
    expect(shortcuts.moveMenu).toBeNull();
    expect(moved.defaultPrevented).toBe(false);

    board.toggleAssigneeFilter('u-other');
    const mine = press('q');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(mine.defaultPrevented).toBe(false);
    const cleared = press('x');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(board.hasActiveFilters).toBe(true);
    expect(cleared.defaultPrevented).toBe(false);
  });

  it('ignores keys while a modal dialog is open', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-modal', '');
    dialog.open = true;
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    button.focus();

    board.setFilterQuery('boss');
    const cleared = press('x');
    expect(board.filterQuery).toBe('boss');
    expect(cleared.defaultPrevented).toBe(false);

    const mine = press('q');
    expect(board.filterAssigneeIds).toEqual([]);
    expect(mine.defaultPrevented).toBe(false);

    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    selection.set(TASK_1);
    const done = press('d');
    expect(moveTask).not.toHaveBeenCalled();
    expect(done.defaultPrevented).toBe(false);

    const moved = press('m');
    expect(shortcuts.moveMenu).toBeNull();
    expect(moved.defaultPrevented).toBe(false);
  });
});

describe('board shortcuts', () => {
  it('navigates the selection with j/k and preventDefaults', () => {
    const event = press('j');
    expect(selection.cursorTaskId).toBe(TASK_1);
    expect(event.defaultPrevented).toBe(true);
    press('j');
    expect(selection.cursorTaskId).toBe(TASK_2);
    press('k');
    expect(selection.cursorTaskId).toBe(TASK_1);
  });

  it('opens the selected task with Enter', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set(TASK_1);
    press('Enter');
    expect(navigate).toHaveBeenCalledWith(TASK_PATH);
  });

  it('opens the quick-label menu for the selection', () => {
    selection.set(TASK_1);
    press('l');
    expect(shortcuts.labelMenu).toBe(TASK_1);
  });

  it('opens the dependency menu for the selection in both directions', () => {
    selection.set(TASK_1);
    const blockedBy = press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocker' });
    expect(blockedBy.defaultPrevented).toBe(true);

    shortcuts.reset();
    selection.set(TASK_1);
    const blocks = press('B', { shiftKey: true });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocked' });
    expect(blocks.defaultPrevented).toBe(true);
  });

  it('reads the direction off shiftKey, not the character (CapsLock)', () => {
    selection.set(TASK_1);
    press('B');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocker' });
  });

  it('does nothing for b without a selection', () => {
    const event = press('b');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves modified b presses to the browser', () => {
    selection.set(TASK_1);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const event = press('b', init);
      expect(shortcuts.dependencyMenu).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('leaves Cmd+L and Cmd+A to the browser', () => {
    selection.set(TASK_1);
    const label = press('l', { metaKey: true });
    expect(shortcuts.labelMenu).toBeNull();
    expect(label.defaultPrevented).toBe(false);

    const assignee = press('a', { metaKey: true });
    expect(shortcuts.assigneeMenu).toBeNull();
    expect(assignee.defaultPrevented).toBe(false);
  });

  it('opens the move menu for the selection, under CapsLock too', () => {
    selection.set(TASK_1);
    const event = press('m');
    expect(shortcuts.moveMenu).toBe(TASK_1);
    expect(event.defaultPrevented).toBe(true);

    shortcuts.reset();
    selection.set(TASK_1);
    const caps = press('M');
    expect(shortcuts.moveMenu).toBe(TASK_1);
    expect(caps.defaultPrevented).toBe(true);
  });

  it('does nothing for m without a selection', () => {
    const event = press('m');
    expect(shortcuts.moveMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves modified m presses (Cmd+M minimises) to the browser', () => {
    selection.set(TASK_1);
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const event = press('m', init);
      expect(shortcuts.moveMenu).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('swallows selection keys while the move menu is open and closes it on Escape', () => {
    selection.set(TASK_1);
    press('m');
    expect(shortcuts.anyMenuOpen).toBe(true);
    press('j');
    expect(selection.cursorTaskId).toBe(TASK_1);
    const closed = press('Escape');
    expect(shortcuts.moveMenu).toBeNull();
    expect(closed.defaultPrevented).toBe(true);
  });

  it('clears an open move menu on reset', () => {
    selection.set(TASK_1);
    press('m');
    shortcuts.reset();
    expect(shortcuts.moveMenu).toBeNull();
    expect(shortcuts.anyMenuOpen).toBe(false);
  });

  it('swallows selection keys while the dependency menu is open and closes it on Escape', () => {
    selection.set(TASK_1);
    press('b');
    press('j');
    expect(selection.cursorTaskId).toBe(TASK_1);
    const closed = press('Escape');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(closed.defaultPrevented).toBe(true);
  });

  it('clears an open dependency menu on reset', () => {
    selection.set(TASK_1);
    press('b');
    expect(shortcuts.anyMenuOpen).toBe(true);
    shortcuts.reset();
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(shortcuts.anyMenuOpen).toBe(false);
  });

  it('requests quick-add in the selected column, else the first column', () => {
    press('n');
    expect(shortcuts.quickAddColumn).toBe('c1');
    shortcuts.quickAddColumn = null;
    selection.set(TASK_1);
    press('n');
    expect(shortcuts.quickAddColumn).toBe('c1');
  });

  it('moves the selected task to the first done column with d', () => {
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    selection.set(TASK_1);
    press('d');
    expect(moveTask).toHaveBeenCalledWith(TASK_1, 'done', {
      position: 1000,
      sort_key: expect.any(String),
    });
  });

  it('duplicates the selected task with Shift+D and preventDefaults', () => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue('copy');
    selection.set(TASK_1);

    const event = press('D', { shiftKey: true });

    expect(duplicateTask).toHaveBeenCalledWith(TASK_1);
    expect(event.defaultPrevented).toBe(true);
    expect(selection.cursorTaskId).toBe(TASK_1);
  });

  it('ignores autorepeat on Shift+D so a held key mints one copy', () => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue('copy');
    selection.set(TASK_1);

    press('D', { shiftKey: true });
    const repeated = press('D', { shiftKey: true, repeat: true });

    expect(duplicateTask).toHaveBeenCalledTimes(1);
    expect(repeated.defaultPrevented).toBe(false);
  });

  it('still marks done on a held d, which is idempotent', () => {
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    selection.set(TASK_1);

    press('d', { repeat: true });

    expect(moveTask).toHaveBeenCalledWith(TASK_1, 'done', {
      position: 1000,
      sort_key: expect.any(String),
    });
  });

  it('follows the shift modifier rather than the case of the key', () => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue('copy');
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    selection.set(TASK_1);

    press('d', { shiftKey: true });
    expect(duplicateTask).toHaveBeenCalledWith(TASK_1);
    expect(moveTask).not.toHaveBeenCalled();

    press('D', { shiftKey: false });
    expect(moveTask).toHaveBeenCalledWith(TASK_1, 'done', {
      position: 1000,
      sort_key: expect.any(String),
    });
    expect(duplicateTask).toHaveBeenCalledTimes(1);
  });

  it('leaves a modified d or Shift+D to the browser, and does nothing without a selection', () => {
    const duplicateTask = vi.spyOn(board, 'duplicateTask').mockResolvedValue('copy');
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    selection.set(TASK_1);

    expect(press('D', { shiftKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(press('d', { metaKey: true }).defaultPrevented).toBe(false);

    selection.clear();
    expect(press('D', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press('d').defaultPrevented).toBe(false);

    expect(duplicateTask).not.toHaveBeenCalled();
    expect(moveTask).not.toHaveBeenCalled();
  });

  it('clears the selection on Escape, then does nothing', () => {
    selection.set(TASK_1);
    const cleared = press('Escape');
    expect(selection.cursorTaskId).toBeNull();
    expect(cleared.defaultPrevented).toBe(true);
    const noop = press('Escape');
    expect(noop.defaultPrevented).toBe(false);
  });

  it('opens the help overlay with ?', () => {
    press('?');
    expect(shortcuts.helpOpen).toBe(true);
  });

  it('requests filter focus with f and preventDefaults', () => {
    const event = press('f');
    expect(shortcuts.filterFocusRequested).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    shortcuts.reset();
    const caps = press('F');
    expect(shortcuts.filterFocusRequested).toBe(true);
    expect(caps.defaultPrevented).toBe(true);
  });

  it('leaves modified f presses (find-in-page) to the browser', () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const event = press('f', init);
      expect(shortcuts.filterFocusRequested).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('clears a pending filter focus request on reset', () => {
    press('f');
    expect(shortcuts.filterFocusRequested).toBe(true);
    shortcuts.reset();
    expect(shortcuts.filterFocusRequested).toBe(false);
  });

  it('filters to the current user with q and preventDefaults', () => {
    const event = press('q');
    expect(board.filterAssigneeIds).toEqual([me.id]);
    expect(board.hasActiveFilters).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('toggles the my-tasks filter back off with a second q', () => {
    press('q');
    expect(board.filterAssigneeIds).toEqual([me.id]);
    press('q');
    expect(board.filterAssigneeIds).toEqual([]);
    expect(board.hasActiveFilters).toBe(false);
  });

  it('adds to rather than replaces the other assignee filters', () => {
    board.filterAssigneeIds = ['u-other'];
    press('q');
    expect(board.filterAssigneeIds).toEqual(['u-other', me.id]);
    press('q');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
  });

  it('leaves the label and query filters alone when q runs', () => {
    board.setFilterQuery('boss');
    board.toggleLabelFilter('lab');
    press('q');
    expect(board.filterAssigneeIds).toEqual([me.id]);
    expect(board.filterQuery).toBe('boss');
    expect(board.filterLabelIds).toEqual(['lab']);
  });

  it('does not exclude done tasks with q', () => {
    board.tasks = [
      ...board.tasks,
      { ...task('d-other', 'done', 1000), assignee_ids: [] },
      { ...task('d-mine', 'done', 2000), assignee_ids: [me.id] },
    ];
    press('q');
    const mine = board.tasks.find((t) => t.id === 'd-mine')!;
    const other = board.tasks.find((t) => t.id === 'd-other')!;
    expect(board.taskMatchesFilters(mine)).toBe(true);
    expect(board.taskMatchesFilters(other)).toBe(false);
    expect(board.displayTasksInColumn('done').map((t) => t.id)).toEqual(['d-mine', 'd-other']);
  });

  it('toggles the my-tasks filter under CapsLock', () => {
    press('Q');
    expect(board.filterAssigneeIds).toEqual([me.id]);
  });

  it('does nothing for q without a session user', () => {
    session.user = null;
    const event = press('q');
    expect(board.filterAssigneeIds).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves modified q presses to the browser', () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const event = press('q', init);
      expect(board.filterAssigneeIds).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('clears every filter facet with x and preventDefaults', () => {
    board.toggleLabelFilter('lab');
    board.toggleAssigneeFilter('u-other');
    board.setFilterQuery('boss');
    const event = press('x');
    expect(board.filterLabelIds).toEqual([]);
    expect(board.filterAssigneeIds).toEqual([]);
    expect(board.filterQuery).toBe('');
    expect(board.hasActiveFilters).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not preventDefault x with nothing to clear', () => {
    const event = press('x');
    expect(event.defaultPrevented).toBe(false);
  });

  it('clears the filters under CapsLock', () => {
    board.setFilterQuery('boss');
    press('X');
    expect(board.filterQuery).toBe('');
  });

  it('leaves modified x presses (cut) to the browser', () => {
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      board.setFilterQuery('boss');
      const event = press('x', init);
      expect(board.filterQuery).toBe('boss');
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('leaves the graph done toggle alone when x clears the filters', () => {
    board.graphShowDone = true;
    board.setFilterQuery('boss');
    press('x');
    expect(board.filterQuery).toBe('');
    expect(board.graphShowDone).toBe(true);
  });

  it('swallows q while a quick menu is open', () => {
    selection.set(TASK_1);
    press('b');
    expect(shortcuts.anyMenuOpen).toBe(true);
    press('q');
    expect(board.filterAssigneeIds).toEqual([]);
  });
});

describe('multi-select shortcuts', () => {
  beforeEach(() => {
    board.tasks = [
      task(TASK_1, 'c1', 1000, 'A'),
      task(TASK_2, 'c1', 2000, 'B'),
      task(testUuid('t3'), 'c1', 3000, 'C'),
    ];
  });

  it('toggles the cursor card in and out of the set with s', () => {
    selection.set(TASK_1);

    expect(press('s').defaultPrevented).toBe(true);
    expect(selection.selectedIds).toEqual([TASK_1]);

    press('s');
    expect(selection.selectedIds).toEqual([]);
  });

  it('leaves s unclaimed with a modifier, with no cursor, and on the graph', () => {
    expect(press('s').defaultPrevented).toBe(false);

    selection.set(TASK_1);
    expect(press('s', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press('s', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press('s', { altKey: true }).defaultPrevented).toBe(false);
    expect(selection.selectedIds).toEqual([]);

    router.navigate(GRAPH_PATH, { replace: true });
    expect(press('s').defaultPrevented).toBe(false);
    expect(selection.selectedIds).toEqual([]);
  });

  it('extends with Shift+Arrow and with Shift+J, and shrinks with Shift+K', () => {
    selection.set(TASK_1);

    press('ArrowDown', { shiftKey: true });
    expect(selection.selectedIds).toEqual([TASK_1, TASK_2]);

    press('J', { shiftKey: true });
    expect(selection.selectedIds).toEqual([TASK_1, TASK_2, testUuid('t3')]);

    press('K', { shiftKey: true });
    expect(selection.selectedIds).toEqual([TASK_1, TASK_2]);
  });

  it('moves the cursor with a plain j and leaves the set alone', () => {
    selection.set(TASK_1);
    press('s');

    press('j');

    expect(selection.cursorTaskId).toBe(TASK_2);
    expect(selection.selectedIds).toEqual([TASK_1]);
  });

  it('opens the bulk menu from l, a and m once more than one card is targeted', () => {
    selection.set(TASK_1);
    press('s');
    press('ArrowDown', { shiftKey: true });

    press('l');
    expect(shortcuts.bulkMenu).toBe('labels');
    expect(shortcuts.labelMenu).toBeNull();
    shortcuts.closeMenus();

    press('a');
    expect(shortcuts.bulkMenu).toBe('assignees');
    expect(shortcuts.assigneeMenu).toBeNull();
    shortcuts.closeMenus();

    press('m');
    expect(shortcuts.bulkMenu).toBe('move');
    expect(shortcuts.moveMenu).toBeNull();
  });

  it('keeps l, a and m single-card when the cursor is on its own', () => {
    selection.set(TASK_1);

    press('l');
    expect(shortcuts.labelMenu).toBe(TASK_1);
    expect(shortcuts.bulkMenu).toBeNull();
    shortcuts.closeMenus();

    press('m');
    expect(shortcuts.moveMenu).toBe(TASK_1);
    expect(shortcuts.bulkMenu).toBeNull();
  });

  it('keeps b, Shift+D and n on the cursor even with a set', () => {
    selection.set(TASK_1);
    press('s');
    press('ArrowDown', { shiftKey: true });

    press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_2, direction: 'blocker' });
    shortcuts.closeMenus();

    press('n');
    expect(shortcuts.quickAddColumn).toBe('c1');
  });

  it('counts bulkMenu as an open menu and closes it with the rest', () => {
    shortcuts.bulkMenu = 'archive';

    expect(shortcuts.anyMenuOpen).toBe(true);
    const swallowed = press('l');
    expect(swallowed.defaultPrevented).toBe(false);

    const escaped = press('Escape');
    expect(escaped.defaultPrevented).toBe(true);
    expect(shortcuts.bulkMenu).toBeNull();
  });

  it('clears set and cursor together on Escape, then does nothing', () => {
    selection.set(TASK_1);
    press('s');
    press('ArrowDown', { shiftKey: true });

    const cleared = press('Escape');

    expect(cleared.defaultPrevented).toBe(true);
    expect(selection.selectedIds).toEqual([]);
    expect(selection.cursorTaskId).toBeNull();
    expect(press('Escape').defaultPrevented).toBe(false);
  });
});

describe('g-chords', () => {
  it('navigates on g then b/g/p within the window', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH);
    press('g');
    press('g');
    expect(navigate).toHaveBeenLastCalledWith(GRAPH_PATH);
    press('g');
    press('p');
    expect(navigate).toHaveBeenLastCalledWith('/');
    press('g');
    press('m');
    expect(navigate).toHaveBeenLastCalledWith('/my-tasks');
  });

  it('keeps the active filter on every in-project jump', () => {
    board.setFilters({ labelIds: [], assigneeIds: [], query: 'boss' });
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    press('g');
    press('g');
    expect(navigate).toHaveBeenLastCalledWith(GRAPH_PATH + '?q=boss');
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH + '?q=boss');

    selection.set(TASK_1);
    press('Enter');
    expect(navigate).toHaveBeenLastCalledWith(TASK_PATH + '?q=boss');

    press('g');
    press('p');
    expect(navigate).toHaveBeenLastCalledWith('/');
  });

  it('jumps to the board of an open task, and nowhere until that task resolves', () => {
    router.navigate(TASK_PATH, { replace: true });
    board.tasks = [];
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    press('g');
    press('b');
    expect(navigate).not.toHaveBeenCalled();

    // The unclaimed b fell through to the overlay's dependency menu.
    shortcuts.reset();
    board.tasks = [task(TASK_1, 'c1', 1000, 'A')];
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH);
  });

  it('reaches both cross-project screens from a route with no project', () => {
    router.navigate('/my-tasks', { replace: true });
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});

    press('g');
    press('p');
    expect(navigate).toHaveBeenLastCalledWith('/');
    press('g');
    press('m');
    expect(navigate).toHaveBeenLastCalledWith('/my-tasks');

    press('m');
    press('g');
    press('b');
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  // The visitor on a shared link cannot load either signed-in screen, so the
  // in-project chords have to stay dead there.
  it('leaves g b and g g inert on a public board', () => {
    const publicPath = publicBoardHref(PROJECT_ID);
    router.navigate(publicPath, { replace: true });

    press('g');
    const toBoard = press('b');
    expect(router.path).toBe(publicPath);
    expect(toBoard.defaultPrevented).toBe(false);

    press('g');
    press('g');
    expect(router.path).toBe(publicPath);
  });

  it('completes the chord under CapsLock rather than opening the dependency menu', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set(TASK_1);
    press('G');
    press('B');
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH);
    expect(shortcuts.dependencyMenu).toBeNull();
  });

  it('gives g then b to the chord rather than the dependency menu', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set(TASK_1);
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH);
    expect(shortcuts.dependencyMenu).toBeNull();
  });

  it('gives g then m to the my-tasks chord rather than the move menu', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set(TASK_1);
    press('g');
    press('m');
    expect(navigate).toHaveBeenLastCalledWith('/my-tasks');
    expect(shortcuts.moveMenu).toBeNull();
  });

  it('does not complete the chord after the window elapses', () => {
    vi.useFakeTimers();
    try {
      const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
      press('g');
      vi.advanceTimersByTime(801);
      press('b');
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('search shortcut', () => {
  it('navigates to search on / from a project view', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const event = press('/');
    expect(navigate).toHaveBeenCalledWith('/search');
    expect(event.defaultPrevented).toBe(true);
  });

  it('stays live with the task overlay open', () => {
    router.navigate(TASK_PATH, { replace: true });
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    press('/');
    expect(navigate).toHaveBeenCalledWith('/search');
  });

  it('leaves a modified press to the browser', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const event = press('/', { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('reaches search from a screen with no project', () => {
    router.navigate('/my-tasks', { replace: true });
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const event = press('/');
    expect(navigate).toHaveBeenCalledWith('/search');
    expect(event.defaultPrevented).toBe(true);
  });

  it('asks for the box instead of navigating when search is already open', () => {
    router.navigate('/search?q=export', { replace: true });
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const event = press('/');
    expect(navigate).not.toHaveBeenCalled();
    expect(shortcuts.searchFocusRequested).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not fire while a text field is focused', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    const event = press('/');
    expect(navigate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('overlay context', () => {
  beforeEach(() => {
    router.navigate(TASK_PATH, { replace: true });
  });

  it('targets the open task with l and a', () => {
    press('l');
    expect(shortcuts.labelMenu).toBe(TASK_1);
    shortcuts.reset();
    press('a');
    expect(shortcuts.assigneeMenu).toBe(TASK_1);
  });

  it('targets the open task with b even with no board selection', () => {
    press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocker' });
    shortcuts.reset();
    press('B', { shiftKey: true });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocked' });
  });

  it('targets the open task with m even with no board selection', () => {
    const event = press('m');
    expect(shortcuts.moveMenu).toBe(TASK_1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not run board selection shortcuts', () => {
    press('j');
    expect(selection.cursorTaskId).toBeNull();
  });

  it('does not request filter focus with f', () => {
    const event = press('f');
    expect(shortcuts.filterFocusRequested).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not touch the filters with q or x', () => {
    board.toggleAssigneeFilter('u-other');
    const mine = press('q');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(mine.defaultPrevented).toBe(false);
    const cleared = press('x');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(cleared.defaultPrevented).toBe(false);
  });

  it('still opens help with ?', () => {
    press('?');
    expect(shortcuts.helpOpen).toBe(true);
  });

  it('stays live inside the overlay dialog, which carries no modal marker', () => {
    const dialog = document.createElement('dialog');
    dialog.open = true;
    const button = document.createElement('button');
    dialog.append(button);
    document.body.append(dialog);
    button.focus();

    press('l');
    expect(shortcuts.labelMenu).toBe(TASK_1);
  });
});

describe('graph view', () => {
  beforeEach(() => {
    router.navigate(GRAPH_PATH, { replace: true });
  });

  it('does not run selection nav (the graph has no card list)', () => {
    const event = press('j');
    expect(selection.cursorTaskId).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('requests filter focus with f (the header filter bar renders here too)', () => {
    const event = press('f');
    expect(shortcuts.filterFocusRequested).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('toggles the my-tasks filter with q and clears it with x', () => {
    const mine = press('q');
    expect(board.filterAssigneeIds).toEqual([me.id]);
    expect(mine.defaultPrevented).toBe(true);
    const cleared = press('x');
    expect(board.hasActiveFilters).toBe(false);
    expect(cleared.defaultPrevented).toBe(true);
  });

  it('does nothing for l without an overlay (no selection to target)', () => {
    selection.set(TASK_1);
    const event = press('l');
    expect(shortcuts.labelMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing for b without an overlay (no selection to target)', () => {
    selection.set(TASK_1);
    const event = press('b');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing for m without an overlay (no selection to target)', () => {
    selection.set(TASK_1);
    const event = press('m');
    expect(shortcuts.moveMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens the help overlay with ?', () => {
    press('?');
    expect(shortcuts.helpOpen).toBe(true);
  });

  it('navigates with g then b back to the board', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith(BOARD_PATH);
  });
});

describe('graph overlay context', () => {
  beforeEach(() => {
    router.navigate(GRAPH_TASK_PATH, { replace: true });
  });

  it('targets the open task with l, a, b and m', () => {
    press('l');
    expect(shortcuts.labelMenu).toBe(TASK_1);
    shortcuts.reset();
    press('a');
    expect(shortcuts.assigneeMenu).toBe(TASK_1);
    shortcuts.reset();
    press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: TASK_1, direction: 'blocker' });
    shortcuts.reset();
    press('m');
    expect(shortcuts.moveMenu).toBe(TASK_1);
  });

  it('does not request filter focus with f', () => {
    const event = press('f');
    expect(shortcuts.filterFocusRequested).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not touch the filters with q or x', () => {
    board.toggleAssigneeFilter('u-other');
    const mine = press('q');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(mine.defaultPrevented).toBe(false);
    const cleared = press('x');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(cleared.defaultPrevented).toBe(false);
  });

  it('navigates with g then g to the graph base', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    press('g');
    press('g');
    expect(navigate).toHaveBeenLastCalledWith(GRAPH_PATH);
  });
});

describe('command palette', () => {
  const MAC_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36';

  function stubUserAgent(value: string): void {
    Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
  }

  afterEach(() => {
    delete (navigator as { userAgent?: string }).userAgent;
  });

  it('opens on Cmd+K and preventDefaults', () => {
    const event = press('k', { metaKey: true });
    expect(shortcuts.paletteOpen).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens on Ctrl+K off Apple platforms, under CapsLock too', () => {
    expect(press('k', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(shortcuts.paletteOpen).toBe(true);

    shortcuts.reset();
    press('K', { ctrlKey: true });
    expect(shortcuts.paletteOpen).toBe(true);
  });

  it('leaves Ctrl+K to macOS, where it kills to end of line in the field it is typed in', () => {
    stubUserAgent(MAC_UA);
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    const event = press('k', { ctrlKey: true });
    expect(shortcuts.paletteOpen).toBe(false);
    expect(event.defaultPrevented).toBe(false);

    expect(press('k', { metaKey: true }).defaultPrevented).toBe(true);
    expect(shortcuts.paletteOpen).toBe(true);
  });

  it('ignores the chord with Shift or Alt held', () => {
    router.navigate('/my-tasks', { replace: true });

    for (const init of [
      { metaKey: true, shiftKey: true },
      { metaKey: true, altKey: true },
      { ctrlKey: true, altKey: true },
    ]) {
      const event = press('k', init);
      expect(shortcuts.paletteOpen).toBe(false);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('moves the selection on an unmodified k', () => {
    selection.set(TASK_2);
    press('k');
    expect(shortcuts.paletteOpen).toBe(false);
    expect(selection.cursorTaskId).toBe(TASK_1);
  });

  // Cmd+K used to fall through to the selection arm, which does not inspect modifiers.
  it('no longer moves the selection on Cmd+K', () => {
    const move = vi.spyOn(selection, 'move');
    selection.set(TASK_2);

    press('k', { metaKey: true });

    expect(move).not.toHaveBeenCalled();
    expect(selection.cursorTaskId).toBe(TASK_2);
  });

  it('opens from inside a focused text field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    expect(press('k', { metaKey: true }).defaultPrevented).toBe(true);
    expect(shortcuts.paletteOpen).toBe(true);
  });

  it('supersedes an open quick menu rather than stacking on it', () => {
    shortcuts.moveMenu = TASK_1;

    press('k', { metaKey: true });

    expect(shortcuts.paletteOpen).toBe(true);
    expect(shortcuts.moveMenu).toBeNull();
  });

  it('opens over the task overlay route', () => {
    router.navigate(TASK_PATH, { replace: true });

    press('k', { metaKey: true });

    expect(shortcuts.paletteOpen).toBe(true);
  });

  it('leaves the key to a foreign modal dialog', () => {
    document.body.innerHTML = '<dialog data-modal open></dialog>';

    const event = press('k', { metaKey: true });

    expect(shortcuts.paletteOpen).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing while a drag is live', () => {
    board.dragging = true;

    const event = press('k', { metaKey: true });

    expect(shortcuts.paletteOpen).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it('closes on a second chord, and holds the key without toggling', () => {
    press('k', { metaKey: true });
    press('k', { metaKey: true });
    expect(shortcuts.paletteOpen).toBe(false);

    press('k', { metaKey: true });
    const repeated = press('k', { metaKey: true, repeat: true });
    expect(shortcuts.paletteOpen).toBe(true);
    expect(repeated.defaultPrevented).toBe(true);
  });

  it('makes the rest of the keymap inert while it is open, and closes on Escape', () => {
    selection.set(TASK_1);
    press('k', { metaKey: true });
    expect(shortcuts.anyMenuOpen).toBe(true);

    press('j');
    expect(selection.cursorTaskId).toBe(TASK_1);

    const closed = press('Escape');
    expect(shortcuts.paletteOpen).toBe(false);
    expect(closed.defaultPrevented).toBe(true);
  });

  it('is cleared by closeMenus and by reset', () => {
    press('k', { metaKey: true });
    shortcuts.closeMenus();
    expect(shortcuts.paletteOpen).toBe(false);

    press('k', { metaKey: true });
    shortcuts.reset();
    expect(shortcuts.paletteOpen).toBe(false);
  });

  it('takes the menu seed down with the menus', () => {
    shortcuts.menuPrefill = 'Done';
    shortcuts.moveMenu = TASK_1;

    shortcuts.closeMenus();

    expect(shortcuts.menuPrefill).toBe('');
  });
});

describe('shortcuts on a read-only board', () => {
  beforeEach(() => {
    board.project = {
      ...board.project!,
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'viewer' }],
    };
    selection.set(TASK_1);
  });

  it('leaves every mutating key unclaimed', () => {
    for (const key of ['n', 'd', 'l', 'a', 'b', 'm', 's']) {
      const event = press(key);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(selection.selectedIds).toEqual([]);

    expect(shortcuts.quickAddColumn).toBeNull();
    expect(shortcuts.labelMenu).toBeNull();
    expect(shortcuts.assigneeMenu).toBeNull();
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(shortcuts.moveMenu).toBeNull();
    expect(board.tasks.find((t) => t.id === TASK_1)?.column_id).toBe('c1');
  });

  it('moves the cursor on Shift+Arrow without building a set', () => {
    expect(press('ArrowDown', { shiftKey: true }).defaultPrevented).toBe(true);

    expect(selection.cursorTaskId).toBe(TASK_2);
    expect(selection.selectedIds).toEqual([]);
  });

  it('does not duplicate on Shift+D', () => {
    const event = press('D', { shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(board.tasks).toHaveLength(2);
  });

  it('keeps navigation, filtering and help live', () => {
    expect(press('j').defaultPrevented).toBe(true);
    expect(press('?').defaultPrevented).toBe(true);
    expect(shortcuts.helpOpen).toBe(true);
    shortcuts.closeMenus();
    expect(press('f').defaultPrevented).toBe(true);
    expect(shortcuts.filterFocusRequested).toBe(true);
  });
});
