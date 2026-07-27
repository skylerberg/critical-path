import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { myTasks, type MyTask } from './myTasks.svelte';

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
});
