import { describe, expect, it } from 'vitest';
import { COLUMN_SORT_OPTIONS, sortTasks, type ColumnSort } from './column-sort';
import type { BoardTask } from './board-types';

function makeTask(partial: Partial<BoardTask> & Pick<BoardTask, 'id'>): BoardTask {
  return {
    id: partial.id,
    column_id: partial.column_id ?? 'c1',
    title: partial.title ?? partial.id,
    description: null,
    sort_key: partial.sort_key ?? 'V0000000001',
    created_at: partial.created_at ?? '2026-01-01T00:00:00Z',
    updated_at: partial.updated_at ?? '2026-01-01T00:00:00Z',
    column_since: partial.column_since ?? '2026-01-01T00:00:00Z',
    label_ids: partial.label_ids ?? [],
    assignee_ids: partial.assignee_ids ?? [],
    blocker_ids: partial.blocker_ids ?? [],
    open_cross_project_blocker_count: 0,
    cover_image_url: partial.cover_image_url ?? null,
    due_date: partial.due_date ?? null,
    comment_count: partial.comment_count ?? 0,
    checklist_item_count: partial.checklist_item_count ?? 0,
    checklist_done_count: partial.checklist_done_count ?? 0,
    attachment_count: partial.attachment_count ?? 0,
  };
}

const tasks: BoardTask[] = [
  makeTask({
    id: 'b',
    title: 'Banana',
    sort_key: 'V0000030001',
    created_at: '2026-03-01T00:00:00Z',
  }),
  makeTask({
    id: 'a',
    title: 'apple',
    sort_key: 'V0000010001',
    created_at: '2026-01-01T00:00:00Z',
  }),
  makeTask({
    id: 'c',
    title: 'Cherry',
    sort_key: 'V0000020001',
    created_at: '2026-02-01T00:00:00Z',
  }),
];

describe('sortTasks', () => {
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
      makeTask({
        id: 'x',
        sort_key: 'V0000000011',
        updated_at: '2026-05-01T00:00:00Z',
      }),
      makeTask({
        id: 'y',
        sort_key: 'V0000000021',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    ];
    expect(sortTasks(withUpdates, 'updated-desc').map((t) => t.id)).toEqual(['x', 'y']);
    expect(sortTasks(withUpdates, 'updated-asc').map((t) => t.id)).toEqual(['y', 'x']);
  });

  it('sorts added-to-column newest and oldest first', () => {
    const added = [
      makeTask({
        id: 'old',
        sort_key: 'V0000000011',
        column_since: '2026-01-01T00:00:00Z',
      }),
      makeTask({
        id: 'new',
        sort_key: 'V0000000021',
        column_since: '2026-09-01T00:00:00Z',
      }),
    ];
    expect(sortTasks(added, 'column_since-desc').map((t) => t.id)).toEqual(['new', 'old']);
    expect(sortTasks(added, 'column_since-asc').map((t) => t.id)).toEqual(['old', 'new']);
  });

  it('breaks timestamp ties by rank (manual order)', () => {
    const tied = [
      makeTask({
        id: 'second',
        sort_key: 'V0000020001',
        created_at: '2026-01-01T00:00:00Z',
      }),
      makeTask({
        id: 'first',
        sort_key: 'V0000010001',
        created_at: '2026-01-01T00:00:00Z',
      }),
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
  it('lists the seven sort keys', () => {
    const values = COLUMN_SORT_OPTIONS.map((option) => option.value);
    expect(values).toEqual<ColumnSort[]>([
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
      expect(option.label.length).toBeGreaterThan(0);
    }
  });
});
