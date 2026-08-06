import { describe, it, expect } from 'vitest';
import { dependentTree, dependents } from '../../src/board';
import type { BoardPayload, BoardTask } from '../../src/resolve';

const TS = '2026-01-01T00:00:00.000Z';

function task(id: string, columnId: string, rank: number, blockerIds: string[] = []): BoardTask {
  return {
    id,
    column_id: columnId,
    title: `Task ${id}`,
    description: null,
    sort_key: `V0${String(rank).padStart(6, '0')}1`,
    due_date: null,
    created_at: TS,
    updated_at: TS,
    column_since: TS,
    label_ids: [],
    assignee_ids: [],
    blocker_ids: blockerIds,
    image_count: 0,
    cover_image_url: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function board(tasks: BoardTask[]): BoardPayload {
  return {
    project: {
      id: 'p1',
      name: 'Fixture',
      description: '',
      created_at: TS,
      created_by: null,
      archived_at: null,
      member_ids: [],
      members: [],
      is_public: false,
      color: null,
    },
    columns: [
      { id: 'todo', name: 'Todo', sort_key: 'V0', is_done: false },
      { id: 'done', name: 'Done', sort_key: 'V1', is_done: true },
    ],
    labels: [],
    tasks,
    changed_task_ids: [],
  };
}

describe('dependents', () => {
  it('returns the tasks blocked by the given task in payload order', () => {
    const fixture = board([
      task('a', 'todo', 500),
      task('c', 'todo', 2000, ['a']),
      task('b', 'todo', 1000, ['a']),
    ]);
    expect(dependents(fixture, 'a').map((t) => t.id)).toEqual(['c', 'b']);
  });

  it('returns nothing for a leaf task or an id absent from the board', () => {
    const fixture = board([task('a', 'todo', 1000), task('b', 'todo', 2000, ['a'])]);
    expect(dependents(fixture, 'b')).toEqual([]);
    expect(dependents(fixture, 'missing')).toEqual([]);
  });

  it('includes dependents sitting in a done column', () => {
    const fixture = board([task('a', 'todo', 1000), task('b', 'done', 2000, ['a'])]);
    expect(dependents(fixture, 'a').map((t) => t.id)).toEqual(['b']);
  });
});

describe('dependentTree', () => {
  it('walks the transitive downstream chain', () => {
    const fixture = board([
      task('a', 'todo', 1000),
      task('b', 'todo', 2000, ['a']),
      task('c', 'todo', 3000, ['b']),
    ]);
    const tree = dependentTree(fixture, 'a');
    expect(tree?.task.id).toBe('a');
    expect(tree?.dependents.map((n) => n.task.id)).toEqual(['b']);
    expect(tree?.dependents[0].dependents.map((n) => n.task.id)).toEqual(['c']);
    expect(tree?.dependents[0].dependents[0].dependents).toEqual([]);
  });

  it('returns a childless root for a leaf and null for an unknown id', () => {
    const fixture = board([task('a', 'todo', 1000), task('b', 'todo', 2000, ['a'])]);
    expect(dependentTree(fixture, 'b')?.dependents).toEqual([]);
    expect(dependentTree(fixture, 'missing')).toBeNull();
  });

  it('terminates on a cyclic fixture without expanding a repeated node', () => {
    const fixture = board([task('a', 'todo', 1000, ['b']), task('b', 'todo', 2000, ['a'])]);
    const tree = dependentTree(fixture, 'a');
    expect(tree?.dependents.map((n) => n.task.id)).toEqual(['b']);
    expect(tree?.dependents[0].dependents).toEqual([]);
  });

  it('reports each node state from its column and blockers', () => {
    const fixture = board([
      task('a', 'todo', 1000),
      task('b', 'done', 2000, ['a']),
      task('c', 'todo', 3000, ['a']),
    ]);
    const tree = dependentTree(fixture, 'a');
    expect(tree?.state).toBe('ready');
    expect(tree?.dependents.map((n) => n.state)).toEqual(['done', 'blocked']);
  });
});
