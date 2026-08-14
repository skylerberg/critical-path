import { describe, expect, it } from 'vitest';
import { mergePersonGroups, mergeTaskPages } from './myTaskGroups';
import type { components } from '../api/api.generated';

type MyTask = components['schemas']['MyTask'];
type MyTaskPersonGroup = components['schemas']['MyTaskPersonGroup'];

function bucketTask(id: string, title = `Task ${id}`): MyTask {
  return {
    id,
    project_id: 'p-1',
    project_name: 'Alpha',
    column_name: 'To Do',
    title,
    assignee_ids: [],
    bucket: 'ready',
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
  };
}

function group(userId: string | null, ...ids: string[]): MyTaskPersonGroup {
  return {
    user_id: userId,
    tasks: ids.map((id) => ({ id, project_id: 'p-1', title: `Task ${id}`, assignee_ids: [] })),
  };
}

function shape(groups: MyTaskPersonGroup[]): Array<[string | null, string[]]> {
  return groups.map((entry) => [entry.user_id, entry.tasks.map((task) => task.id)]);
}

describe('mergeTaskPages', () => {
  it('keeps the pages in the order they arrived', () => {
    const merged = mergeTaskPages([bucketTask('t-1')], [bucketTask('t-2'), bucketTask('t-3')]);

    expect(merged.map((task) => task.id)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('holds one copy of a card served on both pages, keeping the fresher read', () => {
    const merged = mergeTaskPages(
      [bucketTask('t-1'), bucketTask('t-2')],
      [bucketTask('t-2', 'Renamed since page one'), bucketTask('t-3')]
    );

    expect(merged.map((task) => task.id)).toEqual(['t-1', 't-2', 't-3']);
    expect(merged[1]?.title).toBe('Renamed since page one');
  });
});

describe('mergePersonGroups', () => {
  it('files each page’s cards under the person they belong to', () => {
    expect(shape(mergePersonGroups([group('u-b', 't-1')], [group('u-a', 't-2')]))).toEqual([
      ['u-a', ['t-2']],
      ['u-b', ['t-1']],
    ]);
  });

  it('holds one copy of a card that reaches a group from two of the caller’s tasks', () => {
    expect(shape(mergePersonGroups([group('u-a', 't-1')], [group('u-a', 't-1', 't-2')]))).toEqual([
      ['u-a', ['t-1', 't-2']],
    ]);
  });

  // The whole reason the merge re-sorts: a group's size is not known until every
  // page is in, so the order the server sent page one in is already wrong.
  it('puts the busiest person first once the pages are merged', () => {
    const merged = mergePersonGroups(
      [group('u-b', 't-1'), group('u-a', 't-2')],
      [group('u-a', 't-3')]
    );

    expect(shape(merged)).toEqual([
      ['u-a', ['t-2', 't-3']],
      ['u-b', ['t-1']],
    ]);
  });

  // Unassigned is a bucket rather than a person, so it reads last however much
  // work is in it.
  it('keeps Unassigned last even when it is the biggest group', () => {
    const merged = mergePersonGroups(
      [group(null, 't-1', 't-2', 't-3')],
      [group('u-a', 't-4', 't-5'), group('u-b', 't-6')]
    );

    expect(merged.map((entry) => entry.user_id)).toEqual(['u-a', 'u-b', null]);
  });

  it('breaks a tie on the person rather than on which page they arrived from', () => {
    const merged = mergePersonGroups([group('u-zoe', 't-1')], [group('u-ada', 't-2')]);

    expect(merged.map((entry) => entry.user_id)).toEqual(['u-ada', 'u-zoe']);
  });

  it('returns the first page unchanged when there is nothing to merge into it', () => {
    expect(shape(mergePersonGroups([], [group('u-a', 't-1')]))).toEqual([['u-a', ['t-1']]]);
    expect(mergePersonGroups([], [])).toEqual([]);
  });
});
