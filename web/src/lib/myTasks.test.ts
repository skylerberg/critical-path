import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { myTasks, type MyTask } from './myTasks.svelte';
import { projects, type Project } from './projects.svelte';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p-1',
    name: 'Alpha',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: [],
    members: [],
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00.000Z',
    open_task_count: 0,
    done_task_count: 0,
    sort_key: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...overrides,
  };
}

function task(id: string, bucket: MyTask['bucket'], overrides: Partial<MyTask> = {}): MyTask {
  return {
    id,
    project_id: 'p-1',
    project_name: 'Alpha',
    column_name: 'To Do',
    title: `Task ${id}`,
    assignee_ids: ['u-me'],
    bucket,
    waiting_user_ids: [],
    blocking: [],
    blocked_by: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
    ...overrides,
  };
}

const payload = {
  tasks: [task('t-1', 'blocking'), task('t-2', 'ready'), task('t-3', 'blocked')],
  waiting_on_you: [
    {
      user_id: 'u-ada',
      tasks: [{ id: 't-9', project_id: 'p-1', title: 'Importer', assignee_ids: ['u-ada'] }],
    },
  ],
  you_are_waiting_on: [
    { user_id: null, tasks: [{ id: 't-8', project_id: 'p-1', title: 'Format', assignee_ids: [] }] },
  ],
};

beforeEach(() => {
  fetchMock.mockReset();
  myTasks.reset();
  projects.projects = [];
});

describe('myTasks store', () => {
  it('loads the payload and partitions the tasks by bucket', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, payload));

    await myTasks.load();

    expect(new URL(requestAt(0).url).pathname).toBe('/api/my-tasks');
    expect(myTasks.loaded).toBe(true);
    expect(myTasks.error).toBeNull();
    expect(myTasks.tasks.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3']);
    expect(myTasks.blocking.map((t) => t.id)).toEqual(['t-1']);
    expect(myTasks.ready.map((t) => t.id)).toEqual(['t-2']);
    expect(myTasks.blocked.map((t) => t.id)).toEqual(['t-3']);
    expect(myTasks.waitingOnYou[0]?.user_id).toBe('u-ada');
    expect(myTasks.youAreWaitingOn[0]?.user_id).toBeNull();
  });

  it('records the server error and keeps what was already on screen', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, payload));
    await myTasks.load();

    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    await myTasks.load();

    expect(myTasks.error).toBe('Boom');
    expect(myTasks.loaded).toBe(true);
    expect(myTasks.tasks.map((t) => t.id)).toEqual(['t-1', 't-2', 't-3']);
  });

  it('drops the previous error while a retry is in flight', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    await myTasks.load();
    expect(myTasks.error).toBe('Boom');

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await gate;
      return jsonResponse(200, payload);
    });

    const inflight = myTasks.load();
    expect(myTasks.error).toBeNull();
    release?.();
    await inflight;
  });

  it('clears the error on a later successful load', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    await myTasks.load();
    expect(myTasks.error).toBe('Boom');
    expect(myTasks.loaded).toBe(false);

    fetchMock.mockImplementation(async () => jsonResponse(200, payload));
    await myTasks.load();

    expect(myTasks.error).toBeNull();
    expect(myTasks.loaded).toBe(true);
  });

  it('ignores a response that a reset has already superseded', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await gate;
      return jsonResponse(200, payload);
    });

    const inflight = myTasks.load();
    myTasks.reset();
    release?.();
    await inflight;

    expect(myTasks.tasks).toEqual([]);
    expect(myTasks.loaded).toBe(false);
  });

  it('clears everything on reset', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, payload));
    await myTasks.load();

    myTasks.reset();

    expect(myTasks.tasks).toEqual([]);
    expect(myTasks.waitingOnYou).toEqual([]);
    expect(myTasks.youAreWaitingOn).toEqual([]);
    expect(myTasks.loaded).toBe(false);
    expect(myTasks.error).toBeNull();
  });

  it('orders tasks within each bucket to match the project list', async () => {
    // p-1 sits above p-2 on the Projects page; archived p-3 follows both.
    projects.projects = [
      project({ id: 'p-1', name: 'Alpha', sort_key: 'V0000001001' }),
      project({ id: 'p-2', name: 'Bravo', sort_key: 'V0000002001' }),
      project({
        id: 'p-3',
        name: 'Charlie',
        sort_key: 'V0000000501',
        archived_at: '2026-01-02T00:00:00.000Z',
      }),
    ];
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        tasks: [
          task('t-2a', 'ready', { project_id: 'p-2', project_name: 'Bravo' }),
          task('t-3a', 'ready', { project_id: 'p-3', project_name: 'Charlie' }),
          task('t-1a', 'ready', { project_id: 'p-1', project_name: 'Alpha' }),
          task('t-?a', 'ready', { project_id: 'p-x', project_name: 'Unseen' }),
          task('t-1b', 'ready', { project_id: 'p-1', project_name: 'Alpha' }),
        ],
        waiting_on_you: [],
        you_are_waiting_on: [],
      })
    );

    await myTasks.load();

    // Known projects in list order (Alpha before Bravo before archived Charlie);
    // the same project keeps the server's order; the unseen project lands last.
    expect(myTasks.ready.map((t) => `${t.project_id}:${t.id}`)).toEqual([
      'p-1:t-1a',
      'p-1:t-1b',
      'p-2:t-2a',
      'p-3:t-3a',
      'p-x:t-?a',
    ]);
  });

  it('sorts the tasks inside a waiting-on group by project order', async () => {
    projects.projects = [
      project({ id: 'p-1', name: 'Alpha', sort_key: 'V0000001001' }),
      project({ id: 'p-2', name: 'Bravo', sort_key: 'V0000002001' }),
    ];
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        tasks: [],
        waiting_on_you: [],
        you_are_waiting_on: [
          {
            user_id: 'u-ada',
            tasks: [
              { id: 't-2', project_id: 'p-2', title: 'Bravo task', assignee_ids: [] },
              { id: 't-1', project_id: 'p-1', title: 'Alpha task', assignee_ids: [] },
            ],
          },
        ],
      })
    );

    await myTasks.load();

    expect(myTasks.youAreWaitingOn[0]?.tasks.map((t) => t.id)).toEqual(['t-1', 't-2']);
  });
});
