import { describe, expect, it } from 'vitest';
import { COLUMN_SORT_OPTIONS, columnSortLabel, sortTasks, type ColumnSort } from './column-sort';
import type { BoardTask } from './board-types';

function makeTask(partial: Partial<BoardTask> & Pick<BoardTask, 'id'>): BoardTask {
  return {
    id: partial.id,
    column_id: partial.column_id ?? 'c1',
    title: partial.title ?? partial.id,
    description: null,
    position: partial.position ?? 0,
    created_at: partial.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00Z',
    column_since: partial.column_since ?? '2026-01-01T00:00:00Z',
    label_ids: partial.label_ids ?? [],
    assignee_ids: partial.assignee_ids ?? [],
    blocker_ids: partial.blocker_ids ?? [],
    image_count: partial.image_count ?? 0,
    cover_image_url: partial.cover_image_url ?? null,
    due_date: partial.due_date ?? null,
    comment_count: partial.comment_count ?? 0,
  };
}

const tasks: BoardTask[] = [
  makeTask({ id: 'b', title: 'Banana', position: 3000, created_at: '2026-03-01T00:00:00Z' }),
  makeTask({ id: 'a', title: 'apple', position: 1000, created_at: '2026-01-01T00:00:00Z' }),
  makeTask({ id: 'c', title: 'Cherry', position: 2000, created_at: '2026-02-01T00:00:00Z' }),
];

describe('sortTasks', () => {
  it('keeps position order for manual', () => {
    expect(sortTasks(tasks, 'manual').map((t) => t.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts alphabetically by title, case-insensitively', () => {
    expect(sortTasks(tasks, 'title-asc').map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts created newest first', () => {
    expect(sortTasks(tasks, 'created-desc').map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts created oldest first', () => {
    expect(sortTasks(tasks, 'created-asc').map((t) => t.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts updated newest and oldest first', () => {
    const withUpdates = [
      makeTask({ id: 'x', position: 1, updated_at: '2026-05-01T00:00:00Z' }),
      makeTask({ id: 'y', position: 2, updated_at: '2026-01-01T00:00:00Z' }),
    ];
    expect(sortTasks(withUpdates, 'updated-desc').map((t) => t.id)).toEqual(['x', 'y']);
    expect(sortTasks(withUpdates, 'updated-asc').map((t) => t.id)).toEqual(['y', 'x']);
  });

  it('sorts added-to-column newest and oldest first', () => {
    const added = [
      makeTask({ id: 'old', position: 1, column_since: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 'new', position: 2, column_since: '2026-09-01T00:00:00Z' }),
    ];
    expect(sortTasks(added, 'column_since-desc').map((t) => t.id)).toEqual(['new', 'old']);
    expect(sortTasks(added, 'column_since-asc').map((t) => t.id)).toEqual(['old', 'new']);
  });

  it('breaks timestamp ties by position (manual order)', () => {
    const tied = [
      makeTask({ id: 'second', position: 2000, created_at: '2026-01-01T00:00:00Z' }),
      makeTask({ id: 'first', position: 1000, created_at: '2026-01-01T00:00:00Z' }),
    ];
    expect(sortTasks(tied, 'created-desc').map((t) => t.id)).toEqual(['first', 'second']);
  });

  it('does not mutate the input', () => {
    const copy = [...tasks];
    sortTasks(tasks, 'title-asc');
    expect(tasks.map((t) => t.id)).toEqual(copy.map((t) => t.id));
  });
});

describe('COLUMN_SORT_OPTIONS', () => {
  it('includes manual plus the seven requested sorts', () => {
    const values = COLUMN_SORT_OPTIONS.map((option) => option.value);
    expect(values).toEqual<ColumnSort[]>([
      'manual',
      'title-asc',
      'created-desc',
      'created-asc',
      'updated-desc',
      'updated-asc',
      'column_since-desc',
      'column_since-asc',
    ]);
  });

  it('labels every option', () => {
    for (const option of COLUMN_SORT_OPTIONS) {
      expect(columnSortLabel(option.value)).toBe(option.label);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
