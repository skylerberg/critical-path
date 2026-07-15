import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { board, positionAfterDrop } from './board.svelte';
import type { BoardPayload } from './board-types';
import { toasts } from './toasts.svelte';

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
  };
}

function payload(): BoardPayload {
  return {
    project: {
      id: 'p1',
      name: 'Game',
      description: '',
      is_template: false,
      archived_at: null,
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

  it('addBlocker surfaces a 409 cycle error as a toast and refetches', async () => {
    mockRoutes((request) =>
      request.method === 'POST' ? jsonResponse(409, { error: 'Dependency cycle' }) : undefined
    );

    await board.addBlocker('t1', 't2');

    expect(toasts.toasts.map((t) => t.message)).toEqual(['Dependency cycle']);
    expect(board.tasks.find((t) => t.id === 't1')?.blocker_ids).toEqual([]);
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
});
