import { describe, it, expect } from 'vitest';
import { bucketAndOrder, personGroups, type MyTaskRow } from '../../src/services/myTasks';
import type { MyTaskLink } from '../../src/schemas/index';

const ME = 'user-me';

function link(id: string, assigneeIds: string[] = []): MyTaskLink {
  return { id, project_id: 'project-1', title: `Task ${id}`, assignee_ids: assigneeIds };
}

function linkRow(id: string, assigneeIds: string[] = []) {
  return {
    id,
    project_id: 'project-1',
    title: `Task ${id}`,
    assignee_rows: assigneeIds.map((user_id) => ({ user_id })),
  };
}

function row(
  id: string,
  options: {
    assignees?: string[];
    blocking?: ReturnType<typeof linkRow>[];
    blockedBy?: ReturnType<typeof linkRow>[];
  } = {}
): MyTaskRow {
  return {
    id,
    project_id: 'project-1',
    project_name: 'Project One',
    column_name: 'In Progress',
    title: `Task ${id}`,
    assignee_rows: (options.assignees ?? [ME]).map((user_id) => ({ user_id })),
    blocked_by_rows: options.blockedBy ?? [],
    blocking_rows: options.blocking ?? [],
  };
}

describe('bucketAndOrder', () => {
  it('files a task with an unfinished blocker as blocked even when others wait on it', () => {
    const [task] = bucketAndOrder(
      [row('a', { blocking: [linkRow('b', ['user-bob'])], blockedBy: [linkRow('c', [])] })],
      ME
    );
    expect(task.bucket).toBe('blocked');
    expect(task.waiting_user_ids).toEqual(['user-bob']);
  });

  it('files a task whose dependent belongs to someone else as blocking', () => {
    const [task] = bucketAndOrder([row('a', { blocking: [linkRow('b', ['user-bob'])] })], ME);
    expect(task.bucket).toBe('blocking');
    expect(task.waiting_user_ids).toEqual(['user-bob']);
  });

  it('files a task whose only dependent is unassigned as ready', () => {
    const [task] = bucketAndOrder([row('a', { blocking: [linkRow('b')] })], ME);
    expect(task.bucket).toBe('ready');
    expect(task.waiting_user_ids).toEqual([]);
  });

  it('files a task whose only dependent is assigned to the caller as ready', () => {
    const [task] = bucketAndOrder([row('a', { blocking: [linkRow('b', [ME])] })], ME);
    expect(task.bucket).toBe('ready');
    expect(task.waiting_user_ids).toEqual([]);
  });

  it('files a task with no edges as ready', () => {
    expect(bucketAndOrder([row('a')], ME)[0].bucket).toBe('ready');
  });

  it('dedupes, sorts, and drops the caller from waiting_user_ids', () => {
    const [task] = bucketAndOrder(
      [
        row('a', {
          blocking: [linkRow('b', ['user-c', ME, 'user-a']), linkRow('d', ['user-c', 'user-b'])],
        }),
      ],
      ME
    );
    expect(task.waiting_user_ids).toEqual(['user-a', 'user-b', 'user-c']);
  });

  it('orders blocking, then ready, then blocked', () => {
    const tasks = bucketAndOrder(
      [
        row('blocked-one', { blockedBy: [linkRow('x')] }),
        row('ready-one'),
        row('blocking-one', { blocking: [linkRow('y', ['user-bob'])] }),
      ],
      ME
    );
    expect(tasks.map((task) => task.id)).toEqual(['blocking-one', 'ready-one', 'blocked-one']);
  });

  it('orders the blocking bucket by how many people are waiting', () => {
    const tasks = bucketAndOrder(
      [
        row('one', { blocking: [linkRow('x', ['user-a'])] }),
        row('three', { blocking: [linkRow('y', ['user-a', 'user-b', 'user-c'])] }),
        row('two', { blocking: [linkRow('z', ['user-a', 'user-b'])] }),
      ],
      ME
    );
    expect(tasks.map((task) => task.id)).toEqual(['three', 'two', 'one']);
  });

  it('preserves input order between tasks that tie', () => {
    const tasks = bucketAndOrder([row('first'), row('second'), row('third')], ME);
    expect(tasks.map((task) => task.id)).toEqual(['first', 'second', 'third']);
  });

  it('keeps the caller in assignee_ids', () => {
    const [task] = bucketAndOrder([row('a', { assignees: [ME, 'user-bob'] })], ME);
    expect(task.assignee_ids).toEqual([ME, 'user-bob']);
  });
});

describe('personGroups', () => {
  it('puts a link with two other assignees in both of their groups', () => {
    const groups = personGroups([link('a', ['user-a', 'user-b'])], ME, {
      includeUnassigned: false,
    });
    expect(groups.map((group) => group.user_id)).toEqual(['user-a', 'user-b']);
    expect(groups[0].tasks.map((task) => task.id)).toEqual(['a']);
  });

  it('drops a link assigned only to the caller in either mode', () => {
    expect(personGroups([link('a', [ME])], ME, { includeUnassigned: false })).toEqual([]);
    expect(personGroups([link('a', [ME])], ME, { includeUnassigned: true })).toEqual([]);
  });

  it('groups an unassigned link under null only when unassigned links are included', () => {
    expect(personGroups([link('a')], ME, { includeUnassigned: true })).toEqual([
      { user_id: null, tasks: [link('a')] },
    ]);
    expect(personGroups([link('a')], ME, { includeUnassigned: false })).toEqual([]);
  });

  it('dedupes a link that arrives from two of the caller tasks', () => {
    const groups = personGroups([link('a', ['user-a']), link('a', ['user-a'])], ME, {
      includeUnassigned: false,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((task) => task.id)).toEqual(['a']);
  });

  it('sorts by task count, then user id, with the unassigned group last', () => {
    const groups = personGroups(
      [link('a', ['user-b']), link('b', ['user-c', 'user-b']), link('c', ['user-a']), link('d')],
      ME,
      { includeUnassigned: true }
    );
    expect(groups.map((group) => [group.user_id, group.tasks.length])).toEqual([
      ['user-b', 2],
      ['user-a', 1],
      ['user-c', 1],
      [null, 1],
    ]);
  });
});
