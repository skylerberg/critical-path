import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board } from './board.svelte';
import { myTasks } from './myTasks.svelte';
import { search } from './search.svelte';
import { taskRoute } from './task-route.svelte';
import { testUuid } from './test-ids';

const PROJECT_ID = testUuid('p1');
const OTHER_PROJECT_ID = testUuid('p2');
const TASK_ID = testUuid('t1');

function lookupPaths(): string[] {
  return fetchMock.mock.calls.map((_call, index) => new URL(requestAt(index).url).pathname);
}

// Waits for the resolver's own request to settle without reaching into it.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  fetchMock.mockReset();
  taskRoute.reset();
  board.reset();
  myTasks.reset();
  search.reset();
});

describe('locate', () => {
  // Awaited before the assertion, and that is the whole point of it: openapi-fetch
  // dispatches only after a middleware tick, so a synchronous `not.toHaveBeenCalled`
  // here would pass no matter what locate() started.
  it('resolves a project URL synchronously and never looks anything up', async () => {
    expect(taskRoute.locate({ projectId: PROJECT_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });

    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts no lookup of its own for a task it cannot place', async () => {
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });

    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the project off the loaded board, which is what an in-app click hits', () => {
    board.currentProjectId = PROJECT_ID;
    board.tasks = [{ id: TASK_ID }] as never;

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('reads an archived card off the loaded board too', () => {
    board.currentProjectId = PROJECT_ID;
    board.archivedTasks = [{ id: TASK_ID }] as never;

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toMatchObject({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('ignores a public board payload, which proves nothing about a private card', () => {
    board.currentProjectId = PROJECT_ID;
    board.readonly = true;
    board.tasks = [{ id: TASK_ID }] as never;

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
  });

  it('reads the project off my-tasks rows and their link rows', () => {
    myTasks.tasks = [
      {
        id: testUuid('other'),
        project_id: OTHER_PROJECT_ID,
        blocking: [{ id: TASK_ID, project_id: PROJECT_ID }],
        blocked_by: [],
      },
    ] as never;

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('reads the project off a search result', () => {
    search.results = [{ task_id: TASK_ID, project_id: PROJECT_ID }] as never;

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('is pending with nothing loaded', () => {
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
  });

  it('is not-found when the route names no task at all', () => {
    expect(taskRoute.locate({ projectId: null })).toEqual({ status: 'not-found' });
  });
});

describe('ensure', () => {
  it('resolves a cold task link in exactly one lookup and caches it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));

    taskRoute.ensure(TASK_ID);
    await settle();

    expect(lookupPaths()).toEqual([`/api/tasks/${TASK_ID}`]);
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });

    taskRoute.ensure(TASK_ID);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The overlay opens a moment after the lookup answers and asks for the same
  // card, so the payload is handed on rather than thrown away — the difference
  // between one GET /api/tasks/{id} and two back to back.
  it('hands the payload it read to the board', async () => {
    const offer = vi.spyOn(board, 'offerTaskDetail');
    const detail = { id: TASK_ID, project_id: PROJECT_ID, title: 'Design cards' };
    fetchMock.mockResolvedValue(jsonResponse(200, detail));

    taskRoute.ensure(TASK_ID);
    await settle();

    expect(offer).toHaveBeenCalledTimes(1);
    expect(offer.mock.calls[0]![0]).toMatchObject(detail);
  });

  // App.svelte resets this on sign-out because per-account caches must not
  // survive into the next session in this tab. A read still on the wire is the
  // one way in, and it carries a whole card with it.
  it('drops a lookup that lands after the session ended', async () => {
    const offer = vi.spyOn(board, 'offerTaskDetail');
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      })
    );

    taskRoute.ensure(TASK_ID);
    taskRoute.reset();
    answer(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));
    await settle();

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
    expect(offer).not.toHaveBeenCalled();
  });

  it('drops a failure that lands after the session ended', async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        answer = resolve;
      })
    );

    taskRoute.ensure(TASK_ID);
    taskRoute.reset();
    answer(jsonResponse(404, { error: 'Task not found' }));
    await settle();

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
  });

  // The abandoned read's `finally` still runs, and by then the in-flight set
  // holds the next session's read of the same card — releasing it there is what
  // lets the duplicate go out.
  it('does not release the next session’s read when the abandoned one lands', async () => {
    let answerFirst!: (response: Response) => void;
    const queued = [
      new Promise<Response>((resolve) => {
        answerFirst = resolve;
      }),
      new Promise<Response>(() => {}),
    ];
    fetchMock.mockImplementation(() => queued.shift() ?? new Promise<Response>(() => {}));

    taskRoute.ensure(TASK_ID);
    taskRoute.reset();
    taskRoute.ensure(TASK_ID);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    answerFirst(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));
    await settle();

    taskRoute.ensure(TASK_ID);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fire a second request while one is in flight', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));

    taskRoute.ensure(TASK_ID);
    taskRoute.ensure(TASK_ID);
    taskRoute.ensure(TASK_ID);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches a 404 and never asks for a board', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Task not found' }));

    taskRoute.ensure(TASK_ID);
    await settle();

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'not-found',
    });
    expect(lookupPaths()).toEqual([`/api/tasks/${TASK_ID}`]);

    taskRoute.ensure(TASK_ID);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a server failure as an error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    taskRoute.ensure(TASK_ID);
    await settle();

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'error' });
  });

  it('asks again after a server failure, and the second answer wins', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    taskRoute.ensure(TASK_ID);
    await settle();
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'error' });

    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));
    taskRoute.ensure(TASK_ID);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('reads as pending while a retry is in flight, not as the failure it is retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    taskRoute.ensure(TASK_ID);
    await settle();

    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    taskRoute.ensure(TASK_ID);

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
  });

  it('lets a board payload win over a cached failure once it lands', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));
    taskRoute.ensure(TASK_ID);
    await settle();
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'error' });

    board.currentProjectId = PROJECT_ID;
    board.tasks = [{ id: TASK_ID }] as never;

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('resolves a seeded task with no lookup, and reset clears it', async () => {
    taskRoute.seed(TASK_ID, PROJECT_ID);

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    taskRoute.reset();
    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
  });

  it('does not let a seed overwrite what a lookup already answered', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));
    taskRoute.ensure(TASK_ID);
    await settle();

    taskRoute.seed(TASK_ID, OTHER_PROJECT_ID);

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({
      status: 'ready',
      projectId: PROJECT_ID,
    });
  });

  it('reset clears the cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, project_id: PROJECT_ID }));
    taskRoute.ensure(TASK_ID);
    await settle();

    taskRoute.reset();

    expect(taskRoute.locate({ projectId: null, taskId: TASK_ID })).toEqual({ status: 'pending' });
  });
});
