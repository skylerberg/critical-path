import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board, positionAfterDrop } from './board.svelte';
import { noFilters, parseFilters } from './board-filters';
import type { BoardPayload } from './board-types';
import { computeGraph } from './graph';
import { router } from './router.svelte';
import { toasts } from './toasts.svelte';
import { users } from './users.svelte';

const CYCLE_ERROR = 'Adding this blocker would create a dependency cycle';
const SERVER_CREATED_AT = '2026-01-15T00:00:00Z';
const SERVER_UPDATED_AT = '2026-02-01T00:00:00Z';
const SERVER_ARCHIVED_AT = '2026-03-01T00:00:00Z';

function commentBody(text: string) {
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

// Stands in for a payload from an API pod deployed before comment_count existed.
function legacyTask(value: ReturnType<typeof task>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...value };
  delete copy.comment_count;
  return copy;
}

function serverComment(text: string, id = 'srv') {
  return {
    id,
    task_id: 't1',
    user_id: 'u-them',
    body: commentBody(text),
    created_at: SERVER_CREATED_AT,
    updated_at: SERVER_CREATED_AT,
  };
}

function task(id: string, columnId: string, position: number, title: string) {
  return {
    id,
    column_id: columnId,
    title,
    description: null,
    position,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    label_ids: id === 't1' ? ['l1'] : [],
    assignee_ids: [],
    blocker_ids: [],
    image_count: 0,
    comment_count: 0,
  };
}

function payload(): BoardPayload {
  return {
    project: {
      id: 'p1',
      name: 'Game',
      description: '',
      archived_at: null,
      created_by: null,
      member_ids: [],
      is_public: false,
      created_at: '2026-01-01T00:00:00Z',
    },
    columns: [
      { id: 'c2', name: 'Done', position: 2000, is_done: true },
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c3', name: 'Empty', position: 3000, is_done: false },
    ],
    tasks: [task('t2', 'c1', 2000, 'B'), task('t1', 'c1', 1000, 'A'), task('t3', 'c2', 1000, 'C')],
    labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
  };
}

function mockRoutes(override?: (request: Request, url: URL) => Response | undefined): void {
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const url = new URL(request.url);
    const response = override?.(request, url);
    if (response !== undefined) {
      return response;
    }
    if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
      return jsonResponse(200, payload());
    }
    if (request.method === 'GET' && url.pathname === '/api/projects/p1/archived-tasks') {
      return jsonResponse(200, { tasks: [] });
    }
    const archivedTask = /^\/api\/tasks\/([^/]+)\/archive$/.exec(url.pathname);
    if (request.method === 'POST' && archivedTask !== null) {
      const id = archivedTask[1]!;
      const existing = board.tasks.find((t) => t.id === id) ?? task(id, 'c1', 1000, 'x');
      return jsonResponse(200, { ...existing, archived_at: SERVER_ARCHIVED_AT });
    }
    const restoredTask = /^\/api\/tasks\/([^/]+)\/restore$/.exec(url.pathname);
    if (request.method === 'POST' && restoredTask !== null) {
      const id = restoredTask[1]!;
      const source = board.archivedTasks.find((t) => t.id === id) ?? task(id, 'c1', 1000, 'x');
      const restored: Record<string, unknown> = { ...source };
      delete restored.archived_at;
      return jsonResponse(200, restored);
    }
    // createTask and updateTask read timestamps off the response, so these two
    // routes answer with a task rather than the catch-all 204.
    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      const body = (await request.clone().json()) as {
        id: string;
        column_id: string;
        position: number;
        title: string;
      };
      return jsonResponse(201, {
        ...task(body.id, body.column_id, body.position, body.title),
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_UPDATED_AT,
      });
    }
    const patchedTask = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && patchedTask !== null) {
      const id = patchedTask[1]!;
      const existing = board.tasks.find((t) => t.id === id) ?? task(id, 'c1', 1000, 'x');
      return jsonResponse(200, { ...existing, updated_at: SERVER_UPDATED_AT });
    }
    if (request.method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
      return jsonResponse(200, {
        ...task('t1', 'c1', 1000, 'A'),
        comment_count: 1,
        project_id: 'p1',
        images: [],
        comments: [serverComment('resynced')],
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/comments') {
      const body = (await request.clone().json()) as { id: string; task_id: string; body: unknown };
      return jsonResponse(201, {
        ...body,
        user_id: 'u-me',
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_CREATED_AT,
      });
    }
    const patchedComment = /^\/api\/comments\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && patchedComment !== null) {
      const body = (await request.clone().json()) as { body: unknown };
      return jsonResponse(200, {
        id: patchedComment[1]!,
        task_id: 't1',
        user_id: 'u-me',
        body: body.body,
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_UPDATED_AT,
      });
    }
    return jsonResponse(204);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  board.reset();
  for (const toast of [...toasts.toasts]) {
    toasts.dismiss(toast.id);
  }
  mockRoutes();
});

describe('board store load', () => {
  it('fetches the payload, sorts columns by position, and sorts tasks per column', async () => {
    await board.load('p1');

    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p1');
    expect(board.project?.name).toBe('Game');
    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2']);
    expect(board.labels).toHaveLength(1);
    expect(board.loading).toBe(false);
    expect(board.error).toBeNull();
  });

  it('revalidates the same project in the background without a loading flicker', async () => {
    await board.load('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p1'
        ? jsonResponse(200, { ...payload(), project: { ...payload().project, name: 'Renamed' } })
        : undefined
    );

    await board.load('p1');
    expect(board.loading).toBe(false);
    expect(board.project?.name).toBe('Game');

    await vi.waitFor(() => {
      expect(board.project?.name).toBe('Renamed');
    });
    expect(board.loading).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fetches and swaps to a different project', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p2'
        ? jsonResponse(200, { ...payload(), project: { ...payload().project, id: 'p2' } })
        : undefined
    );

    await board.load('p1');
    await board.load('p2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(board.currentProjectId).toBe('p2');
    expect(board.project?.id).toBe('p2');
  });

  it('keeps loading when a superseded load settles before the newer fetch', async () => {
    const pending = new Map<string, (response: Response) => void>();
    fetchMock.mockImplementation((input) => {
      const url = new URL((input as Request).url);
      return new Promise((resolve) => {
        pending.set(url.pathname, resolve);
      });
    });

    const first = board.load('p1');
    await vi.waitFor(() => expect(pending.has('/api/projects/p1')).toBe(true));
    const second = board.load('p2');
    await vi.waitFor(() => expect(pending.has('/api/projects/p2')).toBe(true));

    pending.get('/api/projects/p1')!(jsonResponse(200, payload()));
    await first;

    expect(board.loading).toBe(true);
    expect(board.project).toBeNull();

    pending.get('/api/projects/p2')!(
      jsonResponse(200, { ...payload(), project: { ...payload().project, id: 'p2' } })
    );
    await second;

    expect(board.loading).toBe(false);
    expect(board.project?.id).toBe('p2');
  });

  it('ignores a stale response arriving after a newer load of the same project', async () => {
    const pending: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        })
    );

    const first = board.load('p1');
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    const second = board.load('p2');
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    const third = board.load('p1');
    await vi.waitFor(() => expect(pending).toHaveLength(3));

    pending[1]!(jsonResponse(200, { ...payload(), project: { ...payload().project, id: 'p2' } }));
    await second;
    pending[2]!(
      jsonResponse(200, { ...payload(), project: { ...payload().project, name: 'Fresh' } })
    );
    await third;

    expect(board.project?.name).toBe('Fresh');
    expect(board.loading).toBe(false);

    pending[0]!(
      jsonResponse(200, { ...payload(), project: { ...payload().project, name: 'Stale' } })
    );
    await first;

    expect(board.project?.name).toBe('Fresh');
    expect(board.loading).toBe(false);
  });

  it('discards an in-flight response after reset', async () => {
    const pending: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.push(resolve);
        })
    );

    const first = board.load('p1');
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    board.reset();

    pending[0]!(jsonResponse(200, payload()));
    await first;

    expect(board.project).toBeNull();
    expect(board.currentProjectId).toBeNull();
    expect(board.loading).toBe(false);
  });

  it('retries after a failed load', async () => {
    let failed = false;
    mockRoutes(() => {
      if (!failed) {
        failed = true;
        return jsonResponse(500, { error: 'boom' });
      }
      return undefined;
    });

    await board.load('p1');
    expect(board.error).toBe('boom');

    await board.load('p1');
    expect(board.error).toBeNull();
    expect(board.project?.id).toBe('p1');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('board store readonly mode', () => {
  const publicPayload = {
    project: { id: 'p1', name: 'Public Game', description: 'shared' },
    columns: [
      { id: 'c2', name: 'Done', position: 2000, is_done: true },
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    ],
    tasks: [
      {
        id: 't1',
        column_id: 'c1',
        title: 'A',
        description: null,
        position: 1000,
        label_ids: ['l1'],
        assignee_ids: ['u-ada'],
        blocker_ids: [],
        image_count: 2,
      },
    ],
    labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
    users: [{ id: 'u-ada', name: 'Ada', avatar_url: null }],
  };

  function mockPublic(): void {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/public/projects/p1/board') {
        return jsonResponse(200, publicPayload);
      }
      return jsonResponse(404, { error: 'This board is not public' });
    });
  }

  beforeEach(() => {
    users.reset();
  });

  afterEach(() => {
    users.reset();
  });

  it('loads from the public endpoint and never touches the private one', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(board.readonly).toBe(true);
    expect(board.error).toBeNull();
    expect(board.project?.name).toBe('Public Game');
    expect(board.project?.is_public).toBe(true);
    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(board.labels.map((l) => l.id)).toEqual(['l1']);
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toEqual(['/api/public/projects/p1/board']);
  });

  it('hydrates the project user cache from the payload without emails', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(users.forProject('p1')).toEqual([
      { id: 'u-ada', name: 'Ada', avatar_url: null, email: '' },
    ]);
    expect(users.displayFor('u-ada').name).toBe('Ada');
  });

  it('leaves the user cache alone when a public fetch loses the race', async () => {
    let release = (): void => {};
    const inflightResponse = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await inflightResponse;
      return jsonResponse(200, publicPayload);
    });

    const inflight = board.load('p1', undefined, { readonly: true });
    board.reset();
    users.invalidateAll();
    release();
    await inflight;

    expect(users.forProject('p1')).toEqual([]);
    expect(board.project).toBeNull();
  });

  it('stays on the public endpoint when refetching', async () => {
    mockPublic();
    await board.load('p1', undefined, { readonly: true });
    fetchMock.mockClear();

    await board.refetch();

    expect(new URL(requestAt(0).url).pathname).toBe('/api/public/projects/p1/board');
  });

  it('surfaces the server message when the board is not public', async () => {
    mockPublic();

    await board.load('p2', undefined, { readonly: true });

    expect(board.error).toBe('This board is not public');
    expect(board.project).toBeNull();
  });

  it('ignores realtime events while read-only', async () => {
    mockPublic();
    await board.load('p1', undefined, { readonly: true });

    board.applyRealtime({
      type: 'task_deleted',
      project_id: 'p1',
      data: { id: 't1' },
    });

    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('re-fetches privately when the same project is opened signed in', async () => {
    mockPublic();
    await board.load('p1', undefined, { readonly: true });
    mockRoutes();
    fetchMock.mockClear();

    await board.load('p1');

    expect(board.readonly).toBe(false);
    expect(board.project?.name).toBe('Game');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p1');
  });

  it('clears the readonly flag on reset', async () => {
    mockPublic();
    await board.load('p1', undefined, { readonly: true });

    board.reset();

    expect(board.readonly).toBe(false);
  });
});

describe('board store mutations', () => {
  beforeEach(async () => {
    await board.load('p1');
    fetchMock.mockClear();
  });

  it('moveTask applies optimistically and sends exactly one PATCH', async () => {
    await board.moveTask('t1', 'c2', 3000);

    const moved = board.tasks.find((t) => t.id === 't1');
    expect(moved?.column_id).toBe('c2');
    expect(moved?.position).toBe(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestAt(0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t1');
    expect(await request.json()).toEqual({ column_id: 'c2', position: 3000 });
  });

  it('moveTask failure toasts the error and refetches the board', async () => {
    mockRoutes((request) =>
      request.method === 'PATCH' ? jsonResponse(422, { error: 'nope' }) : undefined
    );

    await board.moveTask('t1', 'c2', 3000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(1).method).toBe('GET');
    const reverted = board.tasks.find((t) => t.id === 't1');
    expect(reverted?.column_id).toBe('c1');
    expect(reverted?.position).toBe(1000);
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('createTask appends at the end of the column and POSTs the position', async () => {
    await board.createTask('c1', 'New task');

    const created = board.tasks.find((t) => t.title === 'New task');
    expect(created?.column_id).toBe('c1');
    expect(created?.position).toBe(3000);
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks');
    expect(await request.json()).toEqual({
      id: created?.id,
      project_id: 'p1',
      column_id: 'c1',
      title: 'New task',
      position: 3000,
    });
  });

  it('createTask adopts created_at and updated_at from the response', async () => {
    await board.createTask('c1', 'New task');

    const created = board.tasks.find((t) => t.title === 'New task');
    expect(created?.created_at).toBe(SERVER_CREATED_AT);
    expect(created?.updated_at).toBe(SERVER_UPDATED_AT);
  });

  it('updateTask sends expected_updated_at and adopts the response updated_at', async () => {
    const outcome = await board.updateTask('t1', { title: 'Renamed' }, '2026-01-01T00:00:00Z');

    expect(outcome).toEqual({ status: 'ok', updated_at: SERVER_UPDATED_AT });
    expect(await requestAt(0).json()).toEqual({
      title: 'Renamed',
      expected_updated_at: '2026-01-01T00:00:00Z',
    });
    expect(board.tasks.find((t) => t.id === 't1')?.updated_at).toBe(SERVER_UPDATED_AT);
    expect(board.tasks.find((t) => t.id === 't1')?.title).toBe('Renamed');
  });

  it('updateTask omits expected_updated_at when no baseline is given', async () => {
    await board.updateTask('t1', { title: 'Renamed' });

    const body = (await requestAt(0).json()) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('expected_updated_at');
  });

  it('updateTask reports a conflict on 409, refetches, and shows no toast', async () => {
    mockRoutes((request) =>
      request.method === 'PATCH' ? jsonResponse(409, { error: 'stale' }) : undefined
    );

    const outcome = await board.updateTask('t1', { title: 'Renamed' }, '2026-01-01T00:00:00Z');

    expect(outcome).toEqual({ status: 'conflict' });
    expect(toasts.toasts).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(1).method).toBe('GET');
    expect(board.tasks.find((t) => t.id === 't1')?.title).toBe('A');
  });

  it('updateTask reports an error, toasts, and refetches on 500', async () => {
    mockRoutes((request) =>
      request.method === 'PATCH' ? jsonResponse(500, { error: 'boom' }) : undefined
    );

    const outcome = await board.updateTask('t1', { title: 'Renamed' }, '2026-01-01T00:00:00Z');

    expect(outcome).toEqual({ status: 'error' });
    expect(toasts.toasts.map((t) => t.message)).toEqual(['boom']);
    expect(requestAt(1).method).toBe('GET');
  });

  it('deleteColumn moves tasks optimistically then applies the 200 moved_tasks positions', async () => {
    mockRoutes((request, url) =>
      request.method === 'DELETE' && url.pathname === '/api/columns/c1'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 4000 },
              { id: 't2', column_id: 'c2', position: 5000 },
            ],
          })
        : undefined
    );

    const pending = board.deleteColumn('c1', 'c2');

    expect(board.columns.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(board.tasksInColumn('c2').map((t) => [t.id, t.position])).toEqual([
      ['t3', 1000],
      ['t1', 2000],
      ['t2', 3000],
    ]);

    await pending;

    expect(board.tasksInColumn('c2').map((t) => [t.id, t.position])).toEqual([
      ['t3', 1000],
      ['t1', 4000],
      ['t2', 5000],
    ]);
    const request = requestAt(0);
    expect(request.method).toBe('DELETE');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/columns/c1');
    expect(url.searchParams.get('move_tasks_to')).toBe('c2');
  });

  it('deleteColumn removes an empty column on 204 without a query parameter', async () => {
    await board.deleteColumn('c3');

    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(board.tasks).toHaveLength(3);
    const url = new URL(requestAt(0).url);
    expect(url.pathname).toBe('/api/columns/c3');
    expect(url.searchParams.has('move_tasks_to')).toBe(false);
  });

  it('setTaskLabels applies optimistically and PUTs the full set', async () => {
    await board.setTaskLabels('t2', ['l1']);

    expect(board.tasks.find((t) => t.id === 't2')?.label_ids).toEqual(['l1']);
    const request = requestAt(0);
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t2/labels');
    expect(await request.json()).toEqual({ label_ids: ['l1'] });
  });

  it('createLabel rethrows a duplicate-name 409 after resyncing, without a toast', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/labels'
        ? jsonResponse(409, { error: 'Label name already in use' })
        : undefined
    );

    await expect(board.createLabel('art', '#ff0000')).rejects.toThrow('Label name already in use');

    expect(board.labels).toHaveLength(1);
    expect(toasts.toasts).toHaveLength(0);
  });

  it('addBlocker names the loop from the 409 body, highlights it, and refetches', async () => {
    mockRoutes((request) =>
      request.method === 'POST'
        ? jsonResponse(409, {
            error: CYCLE_ERROR,
            cycle: [
              { id: 't1', title: 'A' },
              { id: 't2', title: 'B' },
              { id: 't1', title: 'A' },
            ],
          })
        : undefined
    );

    await board.addBlocker('t1', 't2');

    expect(toasts.toasts.map((t) => t.message)).toEqual([`${CYCLE_ERROR}: A → B → A`]);
    expect(board.cyclePath).toEqual([
      { id: 't1', title: 'A' },
      { id: 't2', title: 'B' },
      { id: 't1', title: 'A' },
    ]);
    expect(board.tasks.find((t) => t.id === 't1')?.blocker_ids).toEqual([]);
  });

  it('addBlocker falls back to the plain 409 message when the server sends no cycle', async () => {
    mockRoutes((request) =>
      request.method === 'POST' ? jsonResponse(409, { error: CYCLE_ERROR }) : undefined
    );

    await board.addBlocker('t1', 't2');

    expect(toasts.toasts.map((t) => t.message)).toEqual([CYCLE_ERROR]);
    expect(board.cyclePath).toBeNull();
    expect(board.tasks.find((t) => t.id === 't1')?.blocker_ids).toEqual([]);
  });

  it('addBlocker ignores a malformed cycle in the 409 body', async () => {
    mockRoutes((request) =>
      request.method === 'POST'
        ? jsonResponse(409, {
            error: CYCLE_ERROR,
            cycle: [{ id: 't1', title: 'A' }, { id: 't2' }, { id: 't1', title: 'A' }],
          })
        : undefined
    );

    await board.addBlocker('t1', 't2');

    expect(toasts.toasts.map((t) => t.message)).toEqual([CYCLE_ERROR]);
    expect(board.cyclePath).toBeNull();
  });

  it('addBlocker names the loop from the local pre-check without calling the API', async () => {
    expect(await board.addBlocker('t1', 't2')).toBe(true);
    fetchMock.mockClear();

    expect(await board.addBlocker('t2', 't1')).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toasts.toasts.at(-1)?.message).toBe(`${CYCLE_ERROR}: B → A → B`);
    expect(board.cyclePath?.map((step) => step.id)).toEqual(['t2', 't1', 't2']);
  });

  it('addBlocker names a loop that runs through a done task', async () => {
    expect(await board.addBlocker('t3', 't1')).toBe(true);
    fetchMock.mockClear();

    expect(await board.addBlocker('t1', 't3')).toBe(false);

    expect(toasts.toasts.at(-1)?.message).toBe(`${CYCLE_ERROR} through a done task: A → C → A`);
    expect(board.cyclePath?.map((step) => step.id)).toEqual(['t1', 't3', 't1']);
  });

  it('addBlocker blames a done task only when the named loop runs through one', async () => {
    expect(await board.addBlocker('t2', 't1')).toBe(true);
    expect(await board.addBlocker('t3', 't2')).toBe(true);
    fetchMock.mockClear();

    expect(await board.addBlocker('t1', 't2')).toBe(false);

    expect(toasts.toasts.at(-1)?.message).toBe(`${CYCLE_ERROR}: A → B → A`);
    expect(board.cyclePath?.map((step) => step.id)).toEqual(['t1', 't2', 't1']);
  });

  it('addBlocker keeps the plain message when the loop cannot be named', async () => {
    board.tasks = board.tasks.map((t) => {
      if (t.id === 't1') return { ...t, blocker_ids: ['t2'] };
      if (t.id === 't2') return { ...t, blocker_ids: ['t1'] };
      return { ...t, column_id: 'c1' };
    });

    expect(await board.addBlocker('t3', 't1')).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(toasts.toasts.at(-1)?.message).toBe(CYCLE_ERROR);
    expect(board.cyclePath).toBeNull();
  });

  it('addBlocker elides a long loop and truncates long titles in the message', async () => {
    const longTitle = 'L'.repeat(200);
    board.tasks = Array.from({ length: 9 }, (_, i) =>
      task(`x${String(i)}`, 'c1', (i + 1) * 1000, i === 0 ? longTitle : `title ${String(i)}`)
    ).map((t, i) => (i === 0 ? t : { ...t, blocker_ids: [`x${String(i - 1)}`] }));

    expect(await board.addBlocker('x0', 'x8')).toBe(false);

    expect(board.cyclePath).toHaveLength(10);
    const message = toasts.toasts.at(-1)!.message;
    expect(message.startsWith(`${CYCLE_ERROR}: `)).toBe(true);
    const parts = message.slice(CYCLE_ERROR.length + 2).split(' → ');
    expect(parts).toHaveLength(6);
    expect(parts[4]).toBe('…');
    expect(parts[0]).toBe(parts[5]);
    expect(parts[0]).toBe(`${'L'.repeat(40)}…`);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(41);
    }
  });

  it('cyclePath expires on its own and reset clears it immediately', async () => {
    vi.useFakeTimers();
    try {
      expect(await board.addBlocker('t1', 't2')).toBe(true);
      expect(await board.addBlocker('t2', 't1')).toBe(false);
      expect(board.cyclePath).not.toBeNull();

      vi.advanceTimersByTime(4999);
      expect(board.cyclePath).not.toBeNull();
      vi.advanceTimersByTime(1);
      expect(board.cyclePath).toBeNull();

      expect(await board.addBlocker('t2', 't1')).toBe(false);
      expect(board.cyclePath).not.toBeNull();
      board.reset();
      expect(board.cyclePath).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('addBlocker resolves true when the edge lands and false for no-op or cycle paths', async () => {
    expect(await board.addBlocker('t1', 't2')).toBe(true);

    fetchMock.mockClear();
    expect(await board.addBlocker('t1', 't2')).toBe(false);
    expect(await board.addBlocker('missing', 't3')).toBe(false);
    expect(await board.addBlocker('t2', 't1')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('taskMatchesFilters title query', () => {
  it('matches every task when the query is empty or blank', () => {
    board.setFilterQuery('');
    expect(board.taskMatchesFilters(task('t9', 'c1', 1000, 'Anything'))).toBe(true);
    board.setFilterQuery('   ');
    expect(board.taskMatchesFilters(task('t9', 'c1', 1000, 'Anything'))).toBe(true);
    expect(board.hasActiveFilters).toBe(false);
  });

  it('matches a case-insensitive substring of the title', () => {
    board.setFilterQuery('AL');
    expect(board.taskMatchesFilters(task('t9', 'c1', 1000, 'Alpha'))).toBe(true);
    expect(board.taskMatchesFilters(task('t9', 'c1', 1000, 'Beta'))).toBe(false);
    expect(board.hasActiveFilters).toBe(true);
  });

  it('composes the title query with the label filter', () => {
    board.filterLabelIds = ['l1'];
    board.setFilterQuery('alpha');
    expect(board.taskMatchesFilters(task('t1', 'c1', 1000, 'Alpha'))).toBe(true);
    expect(board.taskMatchesFilters(task('t1', 'c1', 1000, 'Beta'))).toBe(false);
    expect(board.taskMatchesFilters(task('t2', 'c1', 1000, 'Alpha'))).toBe(false);
  });

  it('clearFilters resets the query', () => {
    board.setFilterQuery('x');
    board.clearFilters();
    expect(board.filterQuery).toBe('');
    expect(board.hasActiveFilters).toBe(false);
  });
});

describe('filters carried by load', () => {
  it('adopts the filters it is loaded with and drops them on a project switch', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p2'
        ? jsonResponse(200, { ...payload(), project: { ...payload().project, id: 'p2' } })
        : undefined
    );

    await board.load('p1', { labelIds: ['l1'], assigneeIds: ['u1'], query: 'alpha' });
    expect(board.filterLabelIds).toEqual(['l1']);
    expect(board.filterAssigneeIds).toEqual(['u1']);
    expect(board.filterQuery).toBe('alpha');

    await board.load('p2', noFilters());
    expect(board.hasActiveFilters).toBe(false);
    expect(board.filterSearch).toBe('');
  });

  it('re-applies the filters of a same-project load without a second blocking fetch', async () => {
    await board.load('p1');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await board.load('p1', { labelIds: [], assigneeIds: [], query: 'alpha' });

    expect(board.filterQuery).toBe('alpha');
    expect(board.loading).toBe(false);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('drops label ids the loaded project does not have', async () => {
    await board.load('p1', { labelIds: ['l1', 'l-gone'], assigneeIds: [], query: '' });

    expect(board.filterLabelIds).toEqual(['l1']);
    expect(board.filterSearch).toBe('?labels=l1');
  });

  it('keeps unknown label ids until the payload says which labels exist', async () => {
    let resolve: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    );

    const loading = board.load('p1', { labelIds: ['l-gone'], assigneeIds: [], query: '' });
    await vi.waitFor(() => {
      expect(resolve).toBeDefined();
    });
    expect(board.filterLabelIds).toEqual(['l-gone']);

    resolve!(jsonResponse(200, payload()));
    await loading;
    expect(board.filterLabelIds).toEqual([]);
  });
});

describe('filters in the query string', () => {
  beforeEach(async () => {
    router.navigate('/projects/p1', { replace: true });
    await board.load('p1');
  });

  afterEach(() => {
    board.reset();
    router.navigate('/', { replace: true });
  });

  it('serializes the active filters in a fixed order', () => {
    board.toggleLabelFilter('l1');
    expect(board.filterSearch).toBe('?labels=l1');
    board.setFilterQuery('boss');
    expect(board.filterSearch).toBe('?labels=l1&q=boss');
  });

  it('rewrites the query string without pushing a history entry', () => {
    const historyBefore = window.history.length;

    board.setFilterQuery('boss');

    expect(router.path).toBe('/projects/p1?q=boss');
    expect(window.history.length).toBe(historyBefore);
  });

  // Lagging the write would let the next click push an entry over an unfiltered one.
  it('writes every filter change straight through to the address bar', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    replaceState.mockClear();

    board.toggleLabelFilter('l1');
    expect(router.path).toBe('/projects/p1?labels=l1');

    board.setFilterQuery('boss');
    expect(router.path).toBe('/projects/p1?labels=l1&q=boss');
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it('keeps the overlay path when a filter changes behind an open task', () => {
    router.navigate('/projects/p1/tasks/t1', { replace: true });

    board.toggleLabelFilter('l1');

    expect(router.path).toBe('/projects/p1/tasks/t1?labels=l1');
  });

  it('leaves query keys it does not own in the address bar', () => {
    router.navigate('/projects/p1/tasks/t1?from=my-tasks', { replace: true });

    board.setFilters(parseFilters('?from=my-tasks'));
    expect(router.path).toBe('/projects/p1/tasks/t1?from=my-tasks');

    board.toggleLabelFilter('l1');
    expect(router.path).toBe('/projects/p1/tasks/t1?labels=l1&from=my-tasks');

    board.clearFilters();
    expect(router.path).toBe('/projects/p1/tasks/t1?from=my-tasks');
  });

  it('drops the query string again when the filters are cleared', () => {
    board.setFilterQuery('boss');
    expect(router.path).toBe('/projects/p1?q=boss');

    board.clearFilters();

    expect(router.path).toBe('/projects/p1');
  });

  it('rewrites a hand-ordered query string into the canonical one', () => {
    router.navigate('/projects/p1?q=boss&labels=l1', { replace: true });

    board.setFilters(parseFilters('?q=boss&labels=l1'));

    expect(router.path).toBe('/projects/p1?labels=l1&q=boss');
  });

  it('drops a label the project does not have from an already-unfiltered address bar', () => {
    router.navigate('/projects/p1?labels=l-gone', { replace: true });

    board.setFilters(parseFilters('?labels=l-gone'));

    expect(board.hasActiveFilters).toBe(false);
    expect(router.path).toBe('/projects/p1');
  });

  it('does not touch history when the filter state serializes unchanged', () => {
    board.setFilterQuery('boss');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    replaceState.mockClear();

    board.setFilterQuery('boss ');

    expect(board.filterQuery).toBe('boss');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('prunes a deleted label from both the filter and the query string', async () => {
    board.toggleLabelFilter('l1');
    board.setFilterQuery('alpha');
    expect(router.path).toBe('/projects/p1?labels=l1&q=alpha');

    await board.deleteLabel('l1');

    expect(board.filterLabelIds).toEqual([]);
    expect(router.path).toBe('/projects/p1?q=alpha');
  });

  it('prunes a label another member deleted from the query string', () => {
    board.toggleLabelFilter('l1');
    expect(router.path).toBe('/projects/p1?labels=l1');

    board.applyRealtime({ type: 'label_deleted', project_id: 'p1', data: { id: 'l1' } });

    expect(board.filterLabelIds).toEqual([]);
    expect(router.path).toBe('/projects/p1');
  });

  it('leaves the address bar alone while another route is showing', () => {
    router.navigate('/projects/p2', { replace: true });

    board.toggleLabelFilter('l1');

    expect(board.filterLabelIds).toEqual(['l1']);
    expect(router.path).toBe('/projects/p2');
  });
});

describe('filterSignature', () => {
  it('is unchanged by query edits the matcher normalizes away', () => {
    board.setFilterQuery('alpha');
    const signature = board.filterSignature;

    board.setFilterQuery('  ALPHA ');

    expect(board.filterSignature).toBe(signature);
  });

  it('changes for every filter dimension and returns to the unfiltered value', () => {
    const unfiltered = board.filterSignature;

    board.setFilterQuery('alpha');
    const withQuery = board.filterSignature;
    expect(withQuery).not.toBe(unfiltered);

    board.toggleLabelFilter('l1');
    const withLabel = board.filterSignature;
    expect(withLabel).not.toBe(withQuery);

    board.toggleAssigneeFilter('u1');
    expect(board.filterSignature).not.toBe(withLabel);

    board.clearFilters();
    expect(board.filterSignature).toBe(unfiltered);
  });
});

describe('displayTasksInColumn', () => {
  beforeEach(() => {
    board.tasks = [
      task('t1', 'c1', 1000, 'Alpha'),
      task('t2', 'c1', 2000, 'Beta'),
      { ...task('t3', 'c1', 3000, 'Alpha again'), label_ids: ['l1'] },
      { ...task('t4', 'c1', 4000, 'Gamma'), assignee_ids: ['u1'] },
    ];
  });

  it('returns the pure position order when no filters are active', () => {
    expect(board.displayTasksInColumn('c1')).toEqual(board.tasksInColumn('c1'));
    expect(board.displayTasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
  });

  it('hoists title-query matches above non-matches, position-ordered within each group', () => {
    board.setFilterQuery('alpha');
    expect(board.displayTasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
  });

  it('partitions by label filter', () => {
    board.filterLabelIds = ['l1'];
    expect(board.displayTasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't3', 't2', 't4']);
  });

  it('partitions by assignee filter', () => {
    board.filterAssigneeIds = ['u1'];
    expect(board.displayTasksInColumn('c1').map((t) => t.id)).toEqual(['t4', 't1', 't2', 't3']);
  });

  it('leaves tasksInColumn in position order while filters are active', () => {
    board.setFilterQuery('alpha');
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2', 't3', 't4']);
  });
});

describe('matchingCountInColumn', () => {
  beforeEach(() => {
    board.tasks = [
      // The module-level task() helper hard-codes label_ids ['l1'] for id 't1'.
      { ...task('t1', 'c1', 1000, 'Alpha'), label_ids: [] },
      { ...task('t2', 'c1', 2000, 'Beta'), label_ids: ['l1'] },
      { ...task('t3', 'c1', 3000, 'Alpha again'), label_ids: ['l1'] },
      { ...task('t4', 'c1', 4000, 'Gamma'), assignee_ids: ['u1'] },
      task('t5', 'c2', 1000, 'Alpha elsewhere'),
    ];
  });

  it('returns every task in the column when no filters are active', () => {
    expect(board.matchingCountInColumn('c1')).toBe(4);
    expect(board.matchingCountInColumn('c2')).toBe(1);
    expect(board.matchingCountInColumn('nope')).toBe(0);
  });

  it('counts only title-query matches', () => {
    board.setFilterQuery('alpha');
    expect(board.matchingCountInColumn('c1')).toBe(2);
  });

  it('counts only label matches', () => {
    board.filterLabelIds = ['l1'];
    expect(board.matchingCountInColumn('c1')).toBe(2);
  });

  it('counts only assignee matches', () => {
    board.filterAssigneeIds = ['u1'];
    expect(board.matchingCountInColumn('c1')).toBe(1);
  });

  it('composes filters', () => {
    board.setFilterQuery('alpha');
    board.filterLabelIds = ['l1'];
    expect(board.matchingCountInColumn('c1')).toBe(1);
  });

  it('does not count matches from other columns', () => {
    board.setFilterQuery('alpha');
    expect(board.matchingCountInColumn('c1')).toBe(2);
    expect(board.matchingCountInColumn('c2')).toBe(1);
  });

  it('returns 0 when nothing in the column matches', () => {
    board.setFilterQuery('zzz');
    expect(board.matchingCountInColumn('c1')).toBe(0);
  });
});

describe('createAndLinkTask', () => {
  beforeEach(async () => {
    await board.load('p1');
    fetchMock.mockClear();
  });

  it('creates in the first column, then links the new task as a blocker of the target', async () => {
    const id = await board.createAndLinkTask('New task', { blockerOf: 't3' });

    expect(id).not.toBeNull();
    expect(requestAt(0).method).toBe('POST');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/tasks');
    expect(requestAt(1).method).toBe('POST');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/tasks/t3/blockers');
    expect(await requestAt(1).json()).toEqual({ blocker_task_id: id });

    expect(board.tasks.find((t) => t.id === id)?.column_id).toBe('c1');
    expect(board.tasks.find((t) => t.id === 't3')?.blocker_ids).toContain(id);
  });

  it('links the new task as blocked by the target for the reverse direction', async () => {
    const id = await board.createAndLinkTask('New task', { blockedBy: 't1' });

    expect(new URL(requestAt(1).url).pathname).toBe(`/api/tasks/${id}/blockers`);
    expect(await requestAt(1).json()).toEqual({ blocker_task_id: 't1' });
    expect(board.tasks.find((t) => t.id === id)?.blocker_ids).toEqual(['t1']);
  });

  it('creates an unconnected task when no direction is given', async () => {
    const id = await board.createAndLinkTask('Loose task');

    expect(id).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(requestAt(0).url).pathname).toBe('/api/tasks');
    expect(board.tasks.find((t) => t.id === id)?.blocker_ids).toEqual([]);
  });

  it('does not link when the create fails', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/tasks'
        ? jsonResponse(500, { error: 'boom' })
        : undefined
    );

    const id = await board.createAndLinkTask('New task', { blockerOf: 't3' });

    expect(id).toBeNull();
    const blockerCalls = fetchMock.mock.calls.filter((call) =>
      new URL((call[0] as Request).url).pathname.endsWith('/blockers')
    );
    expect(blockerCalls).toHaveLength(0);
  });
});

describe('deleteTask', () => {
  beforeEach(async () => {
    await board.load('p1');
    fetchMock.mockClear();
  });

  it('removes the task, strips it from other blocker_ids, and drops it from the graph', async () => {
    board.tasks = board.tasks.map((t) => (t.id === 't2' ? { ...t, blocker_ids: ['t1'] } : t));

    await board.deleteTask('t1');

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    expect(board.tasks.find((t) => t.id === 't2')?.blocker_ids).toEqual([]);
    expect(requestAt(0).method).toBe('DELETE');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/tasks/t1');

    const result = computeGraph(board.tasks, board.columns);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.layout.nodes.some((n) => n.id === 't1')).toBe(false);
      expect(result.layout.edges.some((e) => e.from === 't1' || e.to === 't1')).toBe(false);
    }
  });

  it('does not resurrect a task when a failed/aborted DELETE refetches a board that already dropped it', async () => {
    mockRoutes((request, url) => {
      if (request.method === 'DELETE' && url.pathname === '/api/tasks/t1') {
        return jsonResponse(500, { error: 'aborted' });
      }
      if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
        const p = payload();
        return jsonResponse(200, { ...p, tasks: p.tasks.filter((t) => t.id !== 't1') });
      }
      return undefined;
    });

    await board.deleteTask('t1');

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
  });
});

describe('archive', () => {
  function archivedTask(id: string, columnId = 'c1', title = 'A') {
    return { ...task(id, columnId, 1000, title), archived_at: SERVER_ARCHIVED_AT };
  }

  function pathsRequested(): string[] {
    return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
  }

  beforeEach(async () => {
    await board.load('p1');
    fetchMock.mockClear();
  });

  it('loadArchived fills archivedTasks and marks the archive loaded', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p1/archived-tasks'
        ? jsonResponse(200, { tasks: [archivedTask('t9', 'c1', 'Old')] })
        : undefined
    );

    await board.loadArchived();

    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t9']);
    expect(board.archivedLoaded).toBe(true);
    expect(board.archivedLoading).toBe(false);
    expect(board.archivedError).toBeNull();
    expect(new URL(requestAt(0).url).pathname).toBe('/api/projects/p1/archived-tasks');
  });

  it('loadArchived records the error and stays unloaded on failure', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p1/archived-tasks'
        ? jsonResponse(500, { error: 'nope' })
        : undefined
    );

    await board.loadArchived();

    expect(board.archivedError).toBe('nope');
    expect(board.archivedLoaded).toBe(false);
    expect(board.archivedTasks).toEqual([]);
  });

  it('loadArchived reports a 404 rather than claiming the archive is empty', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p1/archived-tasks'
        ? jsonResponse(404, { error: 'Project not found' })
        : undefined
    );

    await board.loadArchived();

    expect(board.archivedError).toBe('Project not found');
    expect(board.archivedLoaded).toBe(false);
  });

  it('loadArchived clears the previous error while a retry is in flight', async () => {
    board.archivedError = 'nope';
    let release!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => inFlight);

    const pending = board.loadArchived();
    expect(board.archivedError).toBeNull();
    expect(board.archivedLoading).toBe(true);

    release(jsonResponse(200, { tasks: [] }));
    await pending;

    expect(board.archivedLoaded).toBe(true);
    expect(board.archivedLoading).toBe(false);
  });

  it('refetchArchived is a no-op until the archive has loaded once, then re-GETs', async () => {
    await board.refetchArchived();
    expect(fetchMock).not.toHaveBeenCalled();

    await board.loadArchived();
    fetchMock.mockClear();

    await board.refetchArchived();
    expect(pathsRequested()).toEqual(['/api/projects/p1/archived-tasks']);
  });

  it('resync reloads the board and, once loaded, the archive', async () => {
    await board.resync();
    expect(pathsRequested()).toEqual(['/api/projects/p1']);

    await board.loadArchived();
    fetchMock.mockClear();

    await board.resync();
    expect(pathsRequested()).toEqual(['/api/projects/p1', '/api/projects/p1/archived-tasks']);
  });

  it('archiveTask drops the card, strips its blocker references, and adopts the server timestamp', async () => {
    board.tasks = board.tasks.map((t) => (t.id === 't2' ? { ...t, blocker_ids: ['t1'] } : t));

    await board.archiveTask('t1');

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    expect(board.tasks.find((t) => t.id === 't2')?.blocker_ids).toEqual([]);
    expect(board.archivedTasks.map((t) => [t.id, t.archived_at])).toEqual([
      ['t1', SERVER_ARCHIVED_AT],
    ]);
    expect(requestAt(0).method).toBe('POST');
    expect(new URL(requestAt(0).url).pathname).toBe('/api/tasks/t1/archive');
  });

  it('archiveTask on failure clears the optimistic row, toasts, and resyncs', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/tasks/t1/archive'
        ? jsonResponse(500, { error: 'boom' })
        : undefined
    );

    await board.archiveTask('t1');

    expect(board.archivedTasks).toEqual([]);
    expect(toasts.toasts.map((t) => t.message)).toContain('boom');
    expect(pathsRequested()).toContain('/api/projects/p1');
  });

  it('restoreTask puts the card back and refetches for the dependents it regains', async () => {
    board.archivedTasks = [archivedTask('t9', 'c1', 'Old')];
    board.archivedLoaded = true;
    mockRoutes((request, url) => {
      if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
        const p = payload();
        return jsonResponse(200, {
          ...p,
          tasks: [...p.tasks, task('t9', 'c1', 1000, 'Old')],
        });
      }
      return undefined;
    });
    fetchMock.mockClear();

    await board.restoreTask('t9');

    expect(board.archivedTasks).toEqual([]);
    expect(board.tasks.some((t) => t.id === 't9')).toBe(true);
    expect(pathsRequested()).toEqual(['/api/tasks/t9/restore', '/api/projects/p1']);
  });

  it('restoreTask leaves the card on the board even when the follow-up refetch fails', async () => {
    board.archivedTasks = [archivedTask('t9', 'c1', 'Old')];
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p1'
        ? jsonResponse(500, { error: 'offline' })
        : undefined
    );

    await board.restoreTask('t9');

    expect(board.tasks.some((t) => t.id === 't9')).toBe(true);
    expect(board.error).toBeNull();
  });

  it('restoreTask outlives an archive load that was already in flight', async () => {
    board.archivedTasks = [archivedTask('t9', 'c1', 'Old')];
    board.archivedLoaded = true;
    let release!: (response: Response) => void;
    const inFlight = new Promise<Response>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const url = new URL(request.url);
      if (url.pathname === '/api/projects/p1/archived-tasks') {
        return inFlight;
      }
      if (url.pathname === '/api/tasks/t9/restore') {
        return jsonResponse(200, task('t9', 'c1', 1000, 'Old'));
      }
      const p = payload();
      return jsonResponse(200, { ...p, tasks: [...p.tasks, task('t9', 'c1', 1000, 'Old')] });
    });

    const loading = board.refetchArchived();
    await board.restoreTask('t9');
    release(jsonResponse(200, { tasks: [archivedTask('t9', 'c1', 'Old')] }));
    await loading;

    expect(board.archivedTasks).toEqual([]);
    expect(board.tasks.some((t) => t.id === 't9')).toBe(true);
    expect(board.archivedLoading).toBe(false);
  });

  it('deleteTask purges the row from the archive as well as the board', async () => {
    board.archivedTasks = [archivedTask('t9')];

    await board.deleteTask('t9');

    expect(board.archivedTasks).toEqual([]);
  });

  it('deleteColumn relocates archived cards with the live ones, and drops them without a target', async () => {
    board.archivedTasks = [{ ...archivedTask('t9', 'c1', 'Old'), position: 1500 }];
    mockRoutes((request, url) =>
      request.method === 'DELETE' && url.pathname === '/api/columns/c1'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 4000 },
              { id: 't9', column_id: 'c2', position: 5000 },
              { id: 't2', column_id: 'c2', position: 6000 },
            ],
          })
        : undefined
    );

    // t1 (1000), t9 (1500), t2 (2000) relocate in position order after t3 (1000).
    const pending = board.deleteColumn('c1', 'c2');
    expect(board.archivedTasks[0]).toMatchObject({ column_id: 'c2', position: 3000 });
    await pending;
    expect(board.archivedTasks[0]).toMatchObject({ column_id: 'c2', position: 5000 });

    board.archivedTasks = [archivedTask('t8', 'c3', 'Gone')];
    await board.deleteColumn('c3');
    expect(board.archivedTasks).toEqual([]);
  });

  it('applyRealtime task_archived moves the card into the archive without duplicating it', () => {
    board.tasks = board.tasks.map((t) => (t.id === 't2' ? { ...t, blocker_ids: ['t1'] } : t));
    const event = { type: 'task_archived', project_id: 'p1', data: archivedTask('t1') } as const;

    board.applyRealtime(event);
    board.applyRealtime(event);

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    expect(board.tasks.find((t) => t.id === 't2')?.blocker_ids).toEqual([]);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('applyRealtime task_restored moves the card back onto the board', () => {
    board.applyRealtime({ type: 'task_archived', project_id: 'p1', data: archivedTask('t1') });
    board.applyRealtime({
      type: 'task_restored',
      project_id: 'p1',
      data: task('t1', 'c1', 1000, 'A'),
    });

    expect(board.archivedTasks).toEqual([]);
    expect(board.tasks.some((t) => t.id === 't1')).toBe(true);
  });

  it('applyRealtime task_deleted and column_deleted keep the archive consistent', () => {
    board.archivedTasks = [archivedTask('t8'), archivedTask('t9')];

    board.applyRealtime({ type: 'task_deleted', project_id: 'p1', data: { id: 't8' } });
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t9']);

    board.applyRealtime({
      type: 'column_deleted',
      project_id: 'p1',
      data: { id: 'c1', moved_tasks: [{ id: 't9', column_id: 'c2', position: 7000 }] },
    });
    expect(board.archivedTasks).toEqual([
      expect.objectContaining({ id: 't9', column_id: 'c2', position: 7000 }),
    ]);

    board.archivedTasks = [archivedTask('t7', 'c2')];
    board.applyRealtime({
      type: 'column_deleted',
      project_id: 'p1',
      data: { id: 'c2', moved_tasks: [] },
    });
    expect(board.archivedTasks).toEqual([]);
  });

  it('reset clears every archive field', async () => {
    await board.loadArchived();
    board.archivedError = 'stale';

    board.reset();

    expect(board.archivedTasks).toEqual([]);
    expect(board.archivedLoaded).toBe(false);
    expect(board.archivedLoading).toBe(false);
    expect(board.archivedError).toBeNull();
  });
});

describe('applyRealtime does not resurrect a deleted task', () => {
  beforeEach(async () => {
    await board.load('p1');
  });

  it('ignores a stale task_updated echo for a task that was just deleted', async () => {
    await board.deleteTask('t1');
    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);

    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: { ...task('t1', 'c1', 1000, 'A'), title: 'A edited' },
    });

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    const result = computeGraph(board.tasks, board.columns);
    if (result.kind === 'ok') {
      expect(result.layout.nodes.some((n) => n.id === 't1')).toBe(false);
    }
  });

  it('still applies a task_updated echo for a task that is present', () => {
    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: { ...task('t2', 'c1', 2000, 'B'), title: 'B renamed' },
    });

    expect(board.tasks.find((t) => t.id === 't2')?.title).toBe('B renamed');
  });
});

describe('board store comments', () => {
  beforeEach(async () => {
    await board.load('p1');
    board.taskComments = { t1: [] };
    fetchMock.mockClear();
  });

  it('createComment appends optimistically and bumps the count before the response resolves', async () => {
    const pending = board.createComment('t1', commentBody('hello'));

    expect(board.taskComments.t1).toHaveLength(1);
    expect(board.taskComments.t1![0]!.body).toEqual(commentBody('hello'));
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(1);

    await pending;

    expect(board.taskComments.t1).toHaveLength(1);
    expect(board.taskComments.t1![0]!.created_at).toBe(SERVER_CREATED_AT);
    expect(new URL(requestAt(0).url).pathname).toBe('/api/comments');
  });

  it('createComment re-inserts the server row when a detail fetch replaces the stream mid-flight', async () => {
    const pending = board.createComment('t1', commentBody('hello'));
    board.taskComments = { t1: [serverComment('landed first', 'cm0')] };

    await pending;

    const bodies = board.taskComments.t1!.map((c) => JSON.stringify(c.body));
    expect(bodies).toHaveLength(2);
    expect(bodies.some((b) => b.includes('hello'))).toBe(true);
  });

  it('createComment leaves an uncached stream uncached and loads it once posted', async () => {
    board.taskComments = {};

    await board.createComment('t1', commentBody('hello'));

    expect(board.taskComments.t1).toEqual([serverComment('resynced')]);
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(1);
  });

  it('loadTaskDetail heals the cached counts from the detail payload', async () => {
    board.tasks = board.tasks.map((t) => (t.id === 't1' ? { ...t, comment_count: 7 } : t));

    await board.loadTaskDetail('t1');

    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(1);
    expect(board.tasks.find((t) => t.id === 't1')?.image_count).toBe(0);
  });

  it('createComment failure toasts and re-fetches the detail payload', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/comments'
        ? jsonResponse(404, { error: 'Task not found' })
        : undefined
    );

    await board.createComment('t1', commentBody('doomed'));

    expect(toasts.toasts.map((t) => t.message)).toContain('Task not found');
    expect(board.taskComments.t1).toEqual([serverComment('resynced')]);
  });

  it('updateComment replaces the body and adopts the server row', async () => {
    board.taskComments = { t1: [serverComment('before', 'cm1')] };

    expect(await board.updateComment('t1', 'cm1', commentBody('after'))).toBe(true);

    expect(board.taskComments.t1![0]!.body).toEqual(commentBody('after'));
    expect(board.taskComments.t1![0]!.updated_at).toBe(SERVER_UPDATED_AT);
    expect(new URL(requestAt(0).url).pathname).toBe('/api/comments/cm1');
  });

  it('updateComment reports failure and resyncs the body from the server', async () => {
    board.taskComments = { t1: [serverComment('before', 'cm1')] };
    mockRoutes((request, url) =>
      request.method === 'PATCH' && url.pathname === '/api/comments/cm1'
        ? jsonResponse(404, { error: 'Comment not found' })
        : undefined
    );

    expect(await board.updateComment('t1', 'cm1', commentBody('after'))).toBe(false);

    expect(toasts.toasts.map((t) => t.message)).toContain('Comment not found');
    expect(board.taskComments.t1).toEqual([serverComment('resynced')]);
  });

  it('deleteComment removes the row and decrements the count, never below zero', async () => {
    board.taskComments = { t1: [serverComment('bye', 'cm1')] };
    board.tasks = board.tasks.map((t) => (t.id === 't1' ? { ...t, comment_count: 1 } : t));

    await board.deleteComment('t1', 'cm1');

    expect(board.taskComments.t1).toEqual([]);
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(0);

    await board.deleteComment('t1', 'gone');
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(0);
  });

  it('applyRealtime appends a comment_created and skips the author’s own echo', () => {
    board.applyRealtime({
      type: 'comment_created',
      project_id: 'p1',
      data: { ...serverComment('from a teammate', 'cm9'), comment_count: 1 },
    });

    expect(board.taskComments.t1!.map((c) => c.id)).toEqual(['cm9']);
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(1);

    board.applyRealtime({
      type: 'comment_created',
      project_id: 'p1',
      data: { ...serverComment('from a teammate', 'cm9'), comment_count: 1 },
    });

    expect(board.taskComments.t1).toHaveLength(1);
  });

  it('applyRealtime keeps the cached stream chronological regardless of arrival order', () => {
    for (const [id, at] of [
      ['late', '2026-06-01T00:00:00Z'],
      ['early', '2026-01-01T00:00:00Z'],
    ] as const) {
      board.applyRealtime({
        type: 'comment_created',
        project_id: 'p1',
        data: { ...serverComment(id, id), created_at: at, updated_at: at, comment_count: 1 },
      });
    }

    expect(board.taskComments.t1!.map((c) => c.id)).toEqual(['early', 'late']);
  });

  it('applyRealtime patches a comment_updated in place and removes a comment_deleted by id', () => {
    board.taskComments = { t1: [serverComment('before', 'cm1')] };

    board.applyRealtime({
      type: 'comment_updated',
      project_id: 'p1',
      data: { ...serverComment('after', 'cm1'), updated_at: SERVER_UPDATED_AT },
    });

    expect(board.taskComments.t1![0]!.body).toEqual(commentBody('after'));
    expect(board.taskComments.t1![0]!.updated_at).toBe(SERVER_UPDATED_AT);

    board.applyRealtime({
      type: 'comment_deleted',
      project_id: 'p1',
      data: { id: 'cm1', task_id: 't1', comment_count: 0 },
    });

    expect(board.taskComments.t1).toEqual([]);
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the cached count intact when a task_updated payload omits comment_count', () => {
    board.tasks = board.tasks.map((t) => (t.id === 't1' ? { ...t, comment_count: 4 } : t));
    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: legacyTask(task('t1', 'c1', 1000, 'A renamed')),
    });

    expect(board.tasks.find((t) => t.id === 't1')?.title).toBe('A renamed');
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(4);
  });

  it('defaults comment_count to zero when a task_created payload omits it', () => {
    board.applyRealtime({
      type: 'task_created',
      project_id: 'p1',
      data: legacyTask(task('t9', 'c1', 9000, 'New')),
    });

    expect(board.tasks.find((t) => t.id === 't9')?.comment_count).toBe(0);
  });

  it('reset clears the cached comment streams', () => {
    board.taskComments = { t1: [serverComment('x')] };

    board.reset();

    expect(board.taskComments).toEqual({});
  });
});

describe('positionAfterDrop', () => {
  it('drops into an empty zone at the base position', () => {
    expect(positionAfterDrop([{ id: 'm', position: 500 }], 'm')).toBe(1000);
  });

  it('drops between two tasks at their midpoint', () => {
    const items = [
      { id: 'a', position: 1000 },
      { id: 'm', position: 9999 },
      { id: 'b', position: 2000 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(1500);
  });

  it('drops at the start before the first task', () => {
    const items = [
      { id: 'm', position: 9999 },
      { id: 'a', position: 1000 },
      { id: 'b', position: 2000 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(0);
  });

  it('drops at the end after the last task', () => {
    const items = [
      { id: 'a', position: 1000 },
      { id: 'b', position: 2000 },
      { id: 'm', position: 500 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(3000);
  });

  it('appends when the moved id is not in the items', () => {
    const items = [
      { id: 'a', position: 1000 },
      { id: 'b', position: 2000 },
    ];
    expect(positionAfterDrop(items, 'missing')).toBe(3000);
  });

  it('lands between the card above and the next real position in an unsorted display array', () => {
    const items = [
      { id: 'match', position: 1000 },
      { id: 'm', position: 9999 },
      { id: 'dim1', position: 3000 },
      { id: 'dim2', position: 2000 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(1500);
  });

  it('prepends over all positions when dropped at the display top of an unsorted array', () => {
    const items = [
      { id: 'm', position: 9999 },
      { id: 'match', position: 5000 },
      { id: 'dim', position: 2000 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(1000);
  });

  it('appends after the max-position card even when it is not displayed last', () => {
    const items = [
      { id: 'match', position: 5000 },
      { id: 'm', position: 9999 },
      { id: 'dim1', position: 2000 },
      { id: 'dim2', position: 3000 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(6000);
  });

  it('skips a duplicate neighbor position to the next strictly greater one', () => {
    const items = [
      { id: 'a', position: 1000 },
      { id: 'm', position: 9999 },
      { id: 'b', position: 1000 },
      { id: 'c', position: 2000 },
    ];
    expect(positionAfterDrop(items, 'm')).toBe(1500);
  });
});
