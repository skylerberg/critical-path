import '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shortcuts } from './shortcuts.svelte';
import { selection } from './selection.svelte';
import { board } from './board.svelte';
import { router } from './router.svelte';
import type { BoardTask } from './board-types';

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

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true });
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
    press('j');
    expect(selection.selectedTaskId).toBeNull();
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

  it('does not run board selection shortcuts', () => {
    press('j');
    expect(selection.selectedTaskId).toBeNull();
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

  it('does nothing for l without an overlay (no selection to target)', () => {
    selection.set('t1');
    const event = press('l');
    expect(shortcuts.labelMenu).toBeNull();
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

  it('targets the open task with l and a', () => {
    press('l');
    expect(shortcuts.labelMenu).toBe('t1');
    shortcuts.reset();
    press('a');
    expect(shortcuts.assigneeMenu).toBe('t1');
  });

  it('navigates with g then g to the graph base', () => {
    const navigate = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    press('g');
    press('g');
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1/graph');
  });
});
