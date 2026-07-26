import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortcuts } from './shortcuts.svelte';
import { selection } from './selection.svelte';
import { board } from './board.svelte';
import { router } from './router.svelte';
import { session } from './session.svelte';
import type { BoardTask } from './board-types';

const me = { id: 'u-me', name: 'Ada', email: 'ada@example.com', avatar_url: null };

function task(id: string, columnId: string, position: number): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    position,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
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
  board.currentProjectId = 'p1';
  board.columns = [
    { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    { id: 'done', name: 'Done', position: 2000, is_done: true },
  ];
  board.tasks = [task('t1', 'c1', 1000), task('t2', 'c1', 2000)];
  router.current = { name: 'project', params: { id: 'p1', view: 'board' } };
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
    expect(selection.selectedTaskId).toBeNull();
  });

  it('ignores keys while a drag is active', () => {
    board.dragging = true;
    press('j');
    expect(selection.selectedTaskId).toBeNull();
  });

  it('ignores keys while a text field is focused', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    selection.set('t1');
    press('j');
    expect(selection.selectedTaskId).toBe('t1');
    const event = press('f');
    expect(shortcuts.filterFocusRequested).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    const capsF = press('F');
    expect(shortcuts.filterFocusRequested).toBe(false);
    expect(capsF.defaultPrevented).toBe(false);
    const typed = press('b');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(typed.defaultPrevented).toBe(false);

    board.toggleAssigneeFilter('u-other');
    const mine = press('q');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(mine.defaultPrevented).toBe(false);
    const cleared = press('x');
    expect(board.filterAssigneeIds).toEqual(['u-other']);
    expect(board.hasActiveFilters).toBe(true);
    expect(cleared.defaultPrevented).toBe(false);
  });
});

describe('board shortcuts', () => {
  it('navigates the selection with j/k and preventDefaults', () => {
    const event = press('j');
    expect(selection.selectedTaskId).toBe('t1');
    expect(event.defaultPrevented).toBe(true);
    press('j');
    expect(selection.selectedTaskId).toBe('t2');
    press('k');
    expect(selection.selectedTaskId).toBe('t1');
  });

  it('opens the selected task with Enter', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set('t1');
    press('Enter');
    expect(navigate).toHaveBeenCalledWith('/projects/p1/tasks/t1');
  });

  it('opens the quick-label menu for the selection', () => {
    selection.set('t1');
    press('l');
    expect(shortcuts.labelMenu).toBe('t1');
  });

  it('opens the dependency menu for the selection in both directions', () => {
    selection.set('t1');
    const blockedBy = press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocker' });
    expect(blockedBy.defaultPrevented).toBe(true);

    shortcuts.reset();
    selection.set('t1');
    const blocks = press('B', { shiftKey: true });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocked' });
    expect(blocks.defaultPrevented).toBe(true);
  });

  it('reads the direction off shiftKey, not the character (CapsLock)', () => {
    selection.set('t1');
    press('B');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocker' });
  });

  it('does nothing for b without a selection', () => {
    const event = press('b');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves modified b presses to the browser', () => {
    selection.set('t1');
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      const event = press('b', init);
      expect(shortcuts.dependencyMenu).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('leaves Cmd+L and Cmd+A to the browser', () => {
    selection.set('t1');
    const label = press('l', { metaKey: true });
    expect(shortcuts.labelMenu).toBeNull();
    expect(label.defaultPrevented).toBe(false);

    const assignee = press('a', { metaKey: true });
    expect(shortcuts.assigneeMenu).toBeNull();
    expect(assignee.defaultPrevented).toBe(false);
  });

  it('swallows selection keys while the dependency menu is open and closes it on Escape', () => {
    selection.set('t1');
    press('b');
    press('j');
    expect(selection.selectedTaskId).toBe('t1');
    const closed = press('Escape');
    expect(shortcuts.dependencyMenu).toBeNull();
    expect(closed.defaultPrevented).toBe(true);
  });

  it('clears an open dependency menu on reset', () => {
    selection.set('t1');
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
    selection.set('t1');
    press('n');
    expect(shortcuts.quickAddColumn).toBe('c1');
  });

  it('moves the selected task to the first done column with d', () => {
    const moveTask = vi.spyOn(board, 'moveTask').mockResolvedValue(undefined);
    selection.set('t1');
    press('d');
    expect(moveTask).toHaveBeenCalledWith('t1', 'done', 1000);
  });

  it('clears the selection on Escape, then does nothing', () => {
    selection.set('t1');
    const cleared = press('Escape');
    expect(selection.selectedTaskId).toBeNull();
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
    selection.set('t1');
    press('b');
    expect(shortcuts.anyMenuOpen).toBe(true);
    press('q');
    expect(board.filterAssigneeIds).toEqual([]);
  });
});

describe('g-chords', () => {
  it('navigates on g then b/g/p within the window', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1');
    press('g');
    press('g');
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1/graph');
    press('g');
    press('p');
    expect(navigate).toHaveBeenLastCalledWith('/projects');
  });

  it('completes the chord under CapsLock rather than opening the dependency menu', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set('t1');
    press('G');
    press('B');
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1');
    expect(shortcuts.dependencyMenu).toBeNull();
  });

  it('gives g then b to the chord rather than the dependency menu', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    selection.set('t1');
    press('g');
    press('b');
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1');
    expect(shortcuts.dependencyMenu).toBeNull();
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

describe('overlay context', () => {
  beforeEach(() => {
    router.current = { name: 'project', params: { id: 'p1', view: 'board', taskId: 't1' } };
  });

  it('targets the open task with l and a', () => {
    press('l');
    expect(shortcuts.labelMenu).toBe('t1');
    shortcuts.reset();
    press('a');
    expect(shortcuts.assigneeMenu).toBe('t1');
  });

  it('targets the open task with b even with no board selection', () => {
    press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocker' });
    shortcuts.reset();
    press('B', { shiftKey: true });
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocked' });
  });

  it('does not run board selection shortcuts', () => {
    press('j');
    expect(selection.selectedTaskId).toBeNull();
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
});

describe('graph view', () => {
  beforeEach(() => {
    router.current = { name: 'project', params: { id: 'p1', view: 'graph' } };
  });

  it('does not run selection nav (the graph has no card list)', () => {
    const event = press('j');
    expect(selection.selectedTaskId).toBeNull();
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
    selection.set('t1');
    const event = press('l');
    expect(shortcuts.labelMenu).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does nothing for b without an overlay (no selection to target)', () => {
    selection.set('t1');
    const event = press('b');
    expect(shortcuts.dependencyMenu).toBeNull();
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
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1');
  });
});

describe('graph overlay context', () => {
  beforeEach(() => {
    router.current = { name: 'project', params: { id: 'p1', view: 'graph', taskId: 't1' } };
  });

  it('targets the open task with l, a and b', () => {
    press('l');
    expect(shortcuts.labelMenu).toBe('t1');
    shortcuts.reset();
    press('a');
    expect(shortcuts.assigneeMenu).toBe('t1');
    shortcuts.reset();
    press('b');
    expect(shortcuts.dependencyMenu).toEqual({ taskId: 't1', direction: 'blocker' });
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
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1/graph');
  });
});
