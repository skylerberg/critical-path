import type { BoardTask } from './board-types';
import { byRank } from './ranks';

/**
 * A one-shot sort key. The board is always in manual order; picking one of
 * these rewrites a column's sort keys once to match, then manual order
 * resumes — like sorting files on a desktop.
 */
export type ColumnSort =
  | 'title-asc'
  | 'created-desc'
  | 'created-asc'
  | 'updated-desc'
  | 'updated-asc'
  | 'column_since-desc'
  | 'column_since-asc';

export interface ColumnSortOption {
  value: ColumnSort;
  label: string;
}

export const COLUMN_SORT_OPTIONS: readonly ColumnSortOption[] = [
  { value: 'title-asc', label: 'Alphabetically' },
  { value: 'created-desc', label: 'Created (newest first)' },
  { value: 'created-asc', label: 'Created (oldest first)' },
  { value: 'updated-desc', label: 'Updated (newest first)' },
  { value: 'updated-asc', label: 'Updated (oldest first)' },
  { value: 'column_since-desc', label: 'Added to column (newest first)' },
  { value: 'column_since-asc', label: 'Added to column (oldest first)' },
];

// The rank tiebreak keeps cards that share a timestamp in their existing board
// order, so the sort never reshuffles equal-keyed cards.
function byTimestamp(
  a: BoardTask,
  b: BoardTask,
  key: 'created_at' | 'updated_at' | 'column_since',
  dir: 1 | -1
): number {
  return a[key].localeCompare(b[key]) * dir || byRank(a, b);
}

export function sortTasks(tasks: readonly BoardTask[], sort: ColumnSort): BoardTask[] {
  switch (sort) {
    case 'title-asc':
      return [...tasks].sort((a, b) => a.title.localeCompare(b.title) || byRank(a, b));
    case 'created-desc':
      return [...tasks].sort((a, b) => byTimestamp(a, b, 'created_at', -1));
    case 'created-asc':
      return [...tasks].sort((a, b) => byTimestamp(a, b, 'created_at', 1));
    case 'updated-desc':
      return [...tasks].sort((a, b) => byTimestamp(a, b, 'updated_at', -1));
    case 'updated-asc':
      return [...tasks].sort((a, b) => byTimestamp(a, b, 'updated_at', 1));
    case 'column_since-desc':
      return [...tasks].sort((a, b) => byTimestamp(a, b, 'column_since', -1));
    case 'column_since-asc':
      return [...tasks].sort((a, b) => byTimestamp(a, b, 'column_since', 1));
  }
}
