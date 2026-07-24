import { board } from './board.svelte';

export type NavDirection = 'up' | 'down' | 'left' | 'right';

/**
 * `grid[c]` is the ordered task ids of column `c`, columns left-to-right.
 * Horizontal moves land on the nearest existing row of the next non-empty column.
 */
export function nextSelection(
  grid: readonly (readonly string[])[],
  current: string | null,
  direction: NavDirection
): string | null {
  const flat = grid.flat();
  if (flat.length === 0) {
    return null;
  }
  let col = -1;
  let row = -1;
  if (current !== null) {
    for (let c = 0; c < grid.length; c++) {
      const r = grid[c]!.indexOf(current);
      if (r !== -1) {
        col = c;
        row = r;
        break;
      }
    }
  }
  if (col === -1) {
    return flat[0]!;
  }
  if (direction === 'up') {
    return grid[col]![Math.max(0, row - 1)] ?? current;
  }
  if (direction === 'down') {
    return grid[col]![Math.min(grid[col]!.length - 1, row + 1)] ?? current;
  }
  const step = direction === 'left' ? -1 : 1;
  for (let c = col + step; c >= 0 && c < grid.length; c += step) {
    const column = grid[c]!;
    if (column.length > 0) {
      return column[Math.min(row, column.length - 1)]!;
    }
  }
  return current;
}

class SelectionStore {
  selectedTaskId = $state<string | null>(null);

  set(taskId: string): void {
    this.selectedTaskId = taskId;
  }

  clear(): void {
    this.selectedTaskId = null;
  }

  move(direction: NavDirection): void {
    const grid = board.columns.map((column) =>
      board.displayTasksInColumn(column.id).map((task) => task.id)
    );
    const next = nextSelection(grid, this.selectedTaskId, direction);
    if (next !== null) {
      this.selectedTaskId = next;
    }
  }

  get selectedColumnId(): string | null {
    const id = this.selectedTaskId;
    if (id === null) {
      return null;
    }
    return board.tasks.find((task) => task.id === id)?.column_id ?? null;
  }
}

export const selection = new SelectionStore();
