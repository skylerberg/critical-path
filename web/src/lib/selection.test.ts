import '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextSelection, selection } from './selection.svelte';
import { board } from './board.svelte';
import type { BoardTask } from './board-types';

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

describe('selection store', () => {
  beforeEach(() => {
    board.reset();
    selection.clear();
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Doing', position: 2000, is_done: false },
    ];
    board.tasks = [task('t1', 'c1', 1000), task('t2', 'c1', 2000), task('t3', 'c2', 1000)];
  });

  it('navigates against the live board and reports the selected column', () => {
    selection.move('down');
    expect(selection.selectedTaskId).toBe('t1');
    expect(selection.selectedColumnId).toBe('c1');

    selection.move('down');
    expect(selection.selectedTaskId).toBe('t2');

    selection.move('right');
    expect(selection.selectedTaskId).toBe('t3');
    expect(selection.selectedColumnId).toBe('c2');
  });

  it('orders tasks within a column by position, not insertion order', () => {
    board.tasks = [task('t2', 'c1', 2000), task('t1', 'c1', 1000)];
    selection.move('down');
    expect(selection.selectedTaskId).toBe('t1');
  });
});
