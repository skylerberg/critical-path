import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { board, placementAfterDrop, type TaskAttachment, type TaskSeriesRef } from './board.svelte';
import { noFilters, parseFilters } from './board-filters';
import type { BoardPayload } from './board-types';
import { computeGraph } from './graph';
import { clearOfflineCache } from './offline-cache';
import { outbox } from './outbox.svelte';
import { router } from './router.svelte';
import { selection } from './selection.svelte';
import { session } from './session.svelte';
import { projectHref, taskHref } from './short-links';
import { testUuid } from './test-ids';
import { taskActivity } from './taskActivity.svelte';
import { toasts } from './toasts.svelte';
import { users } from './users.svelte';
import { realtimeEvent } from './realtime-test-events';

const CYCLE_ERROR = 'Adding this blocker would create a dependency cycle';
const SERVER_CREATED_AT = '2026-01-15T00:00:00Z';
const SERVER_UPDATED_AT = '2026-02-01T00:00:00Z';
const SERVER_COVER_IMAGE_URL = '/api/images/copied-img';
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

function serverChecklistItem(
  text = 'resynced item',
  id = 'ci-srv',
  position = 1000,
  checked = false,
  sortKey?: string
) {
  return {
    id,
    task_id: 't1',
    text,
    checked,
    sort_key: sortKey ?? `V0${String(Math.round(position)).padStart(8, '0')}1`,
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
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: id === 't1' ? ['l1'] : [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
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
      members: [],
      is_public: false,
      color: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    columns: [
      { id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true },
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c3', name: 'Empty', sort_key: 'V0000030001', is_done: false },
    ],
    tasks: [task('t2', 'c1', 2000, 'B'), task('t1', 'c1', 1000, 'A'), task('t3', 'c2', 1000, 'C')],
    labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
    changed_task_ids: [],
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
    // createTask, createTasks and updateTask read timestamps off the response, so
    // these routes answer with a task rather than the catch-all 204.
    if (request.method === 'POST' && url.pathname === '/api/tasks/batch') {
      const body = (await request.clone().json()) as {
        column_id: string;
        tasks: { id: string; title: string; sort_key: string }[];
      };
      return jsonResponse(201, {
        tasks: body.tasks.map((item) => ({
          ...task(item.id, body.column_id, 1000, item.title),
          sort_key: item.sort_key,
          created_at: SERVER_CREATED_AT,
          updated_at: SERVER_UPDATED_AT,
        })),
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/tasks') {
      const body = (await request.clone().json()) as {
        id: string;
        column_id: string;
        sort_key: string;
        title: string;
      };
      return jsonResponse(201, {
        ...task(body.id, body.column_id, 1000, body.title),
        sort_key: body.sort_key,
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_UPDATED_AT,
      });
    }
    const duplicatedTask = /^\/api\/tasks\/([^/]+)\/duplicate$/.exec(url.pathname);
    if (request.method === 'POST' && duplicatedTask !== null) {
      const source = board.tasks.find((t) => t.id === duplicatedTask[1]!)!;
      const body = (await request.clone().json()) as { id: string; sort_key: string };
      return jsonResponse(201, {
        ...source,
        id: body.id,
        sort_key: body.sort_key,
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        comment_count: 0,
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_UPDATED_AT,
        // The copy gets its own image row, so its cover never reuses the source's id.
        cover_image_url: source.cover_image_url === null ? null : SERVER_COVER_IMAGE_URL,
      });
    }
    const duplicatedColumn = /^\/api\/columns\/([^/]+)\/duplicate$/.exec(url.pathname);
    if (request.method === 'POST' && duplicatedColumn !== null) {
      const sourceId = duplicatedColumn[1]!;
      const source = board.columns.find((c) => c.id === sourceId)!;
      const body = (await request.clone().json()) as { id: string; sort_key: string };
      return jsonResponse(201, {
        column: {
          id: body.id,
          project_id: 'p1',
          name: source.name,
          sort_key: body.sort_key,
          is_done: source.is_done,
          created_at: SERVER_CREATED_AT,
        },
        tasks: board.tasks
          .filter((t) => t.column_id === sourceId)
          .map((t) => ({ ...t, id: `copy-${t.id}`, column_id: body.id, blocker_ids: [] })),
      });
    }
    const reorderedColumn = /^\/api\/columns\/([^/]+)\/reorder$/.exec(url.pathname);
    if (request.method === 'POST' && reorderedColumn !== null) {
      const columnId = reorderedColumn[1]!;
      const body = (await request.clone().json()) as { task_ids: string[] };
      return jsonResponse(200, {
        moved_tasks: body.task_ids.map((id, index) => ({
          id,
          column_id: columnId,
          sort_key: `V0${String((index + 1) * 1000).padStart(8, '0')}1`,
        })),
      });
    }
    const patchedTask = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && patchedTask !== null) {
      const id = patchedTask[1]!;
      const existing = board.tasks.find((t) => t.id === id) ?? task(id, 'c1', 1000, 'x');
      return jsonResponse(200, { ...existing, updated_at: SERVER_UPDATED_AT });
    }
    if (request.method === 'GET' && /^\/api\/tasks\/[^/]+\/activity$/.test(url.pathname)) {
      return jsonResponse(200, { activity: [] });
    }
    if (request.method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
      return jsonResponse(200, {
        ...task('t1', 'c1', 1000, 'A'),
        comment_count: 1,
        checklist_item_count: 1,
        checklist_done_count: 0,
        project_id: 'p1',
        images: [],
        comments: [serverComment('resynced')],
        checklist_items: [serverChecklistItem()],
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/checklist-items') {
      const body = (await request.clone().json()) as {
        id: string;
        task_id: string;
        text: string;
        position: number;
      };
      return jsonResponse(201, {
        ...body,
        checked: false,
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_CREATED_AT,
      });
    }
    const promotedItem = /^\/api\/checklist-items\/([^/]+)\/promote$/.exec(url.pathname);
    if (request.method === 'POST' && promotedItem !== null) {
      const body = (await request.clone().json()) as { id: string; sort_key: string };
      return jsonResponse(201, {
        ...task(body.id, 'c1', 1000, 'promoted'),
        sort_key: body.sort_key,
        created_at: SERVER_CREATED_AT,
        updated_at: SERVER_UPDATED_AT,
      });
    }
    const patchedItem = /^\/api\/checklist-items\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PATCH' && patchedItem !== null) {
      const id = patchedItem[1]!;
      const body = (await request.clone().json()) as Record<string, unknown>;
      const existing =
        (board.taskChecklists.t1 ?? []).find((item) => item.id === id) ??
        serverChecklistItem('unknown', id);
      return jsonResponse(200, { ...existing, ...body, updated_at: SERVER_UPDATED_AT });
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
  session.user = null;
  taskActivity.reset();
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

  // The error page replaces the whole route, so raising it over a read nobody asked
  // for takes down the board and every editor open in it. On a phone that read is
  // most likely to fail exactly when a handoff interrupts someone mid-sentence.
  it('keeps the loaded board when a background revalidation fails', async () => {
    await board.load('p1');
    const loaded = board.tasks.length;
    expect(loaded).toBeGreaterThan(0);
    mockRoutes(() => jsonResponse(500, { error: 'boom' }));

    await board.load('p1');
    await board.resync();

    expect(board.error).toBeNull();
    expect(board.tasks).toHaveLength(loaded);
    expect(board.project?.id).toBe('p1');
  });

  // Keeping the board up is only half the answer: without this the failure has no
  // surface at all, because nothing else in the sync indicator can stand in for it
  // — a read can fail with an empty outbox and a healthy socket.
  it('records a failed background revalidation, and clears it on the next success', async () => {
    await board.load('p1');
    expect(board.staleRead).toBe(false);

    mockRoutes(() => jsonResponse(500, { error: 'boom' }));
    await board.resync();
    expect(board.staleRead).toBe(true);
    expect(board.error).toBeNull();

    mockRoutes(() => undefined);
    await board.resync();
    expect(board.staleRead).toBe(false);
  });

  // The other half: with nothing painted yet there is nothing to protect, and a
  // silent failure would leave a spinner with no way forward.
  it('still raises the error page when the first load fails', async () => {
    mockRoutes(() => jsonResponse(500, { error: 'boom' }));

    await board.load('p1');

    expect(board.error).toBe('boom');
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
      { id: 'c2', name: 'Done', position: 2000, sort_key: 'V0000020001', is_done: true },
      { id: 'c1', name: 'Todo', position: 1000, sort_key: 'V0000010001', is_done: false },
    ],
    tasks: [
      {
        id: 't1',
        column_id: 'c1',
        title: 'A',
        description: null,
        sort_key: 'V0000010001',
        label_ids: ['l1'],
        assignee_ids: ['u-ada'],
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        image_count: 2,
        cover_image_url: '/api/images/img1',
        comment_count: 2,
        checklist_item_count: 2,
        checklist_done_count: 1,
        attachment_count: 0,
      },
      {
        id: 't2',
        column_id: 'c1',
        title: 'B',
        description: null,
        sort_key: 'V0000020001',
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        open_cross_project_blocker_count: 0,
        image_count: 0,
        cover_image_url: null,
        comment_count: 0,
        checklist_item_count: 0,
        checklist_done_count: 0,
        attachment_count: 0,
      },
    ],
    labels: [{ id: 'l1', name: 'art', color: '#ff0000' }],
    users: [
      { id: 'u-ada', name: 'Ada', avatar_url: null },
      { id: 'u-bo', name: 'Bo', avatar_url: null },
    ],
    comments: [
      {
        id: 'cm1',
        task_id: 't1',
        user_id: 'u-ada',
        body: commentBody('First'),
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'cm2',
        task_id: 't1',
        user_id: 'u-bo',
        body: commentBody('Second'),
        created_at: '2026-01-02T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      },
    ],
    checklist_items: [
      { id: 'ci2', task_id: 't1', text: 'second', checked: false, position: 2000 },
      { id: 'ci1', task_id: 't1', text: 'first', checked: true, position: 1000 },
    ],
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
    expect(board.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(board.tasks[0]?.cover_image_url).toBe('/api/images/img1');
    expect(board.labels.map((l) => l.id)).toEqual(['l1']);
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toEqual(['/api/public/projects/p1/board']);
  });

  it('hydrates the project user cache from the payload', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(users.forProject('p1')).toEqual([
      { id: 'u-ada', name: 'Ada', avatar_url: null },
      { id: 'u-bo', name: 'Bo', avatar_url: null },
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

    board.applyRealtime(realtimeEvent('task_deleted', { id: 't1' }, 'p1'));

    expect(board.tasks.map((t) => t.id)).toEqual(['t1', 't2']);
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

  it('takes the comment stream and counts straight off the published payload', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(board.tasks.map((t) => t.comment_count)).toEqual([2, 0]);
    expect(board.taskComments['t1']?.map((comment) => comment.id)).toEqual(['cm1', 'cm2']);
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toEqual(['/api/public/projects/p1/board']);
  });

  // Undefined is the store's "not loaded" sentinel, and a public board has no
  // detail request coming that would ever resolve it.
  it('marks a commentless published task as loaded rather than pending', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(board.taskComments['t2']).toEqual([]);
  });

  it('names comment authors who are assigned nothing', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(users.displayFor('u-bo').name).toBe('Bo');
  });

  it('serves a board from a pod that predates public comments', async () => {
    const legacy: Record<string, unknown> = { ...publicPayload };
    delete legacy.comments;
    fetchMock.mockImplementation(async () => jsonResponse(200, legacy));

    await board.load('p1', undefined, { readonly: true });

    expect(board.error).toBeNull();
    expect(board.taskComments['t1']).toEqual([]);
  });

  it('seeds every published task a checklist, sorted, and carries the counts to the card face', async () => {
    mockPublic();

    await board.load('p1', undefined, { readonly: true });

    expect(board.taskChecklists['t1']!.map((item) => item.text)).toEqual(['first', 'second']);
    expect(board.taskChecklists['t2']).toEqual([]);
    const [first] = board.tasks.filter((t) => t.id === 't1');
    expect([first!.checklist_item_count, first!.checklist_done_count]).toEqual([2, 1]);
  });

  it('serves a board from a pod that predates public checklists without NaN counts', async () => {
    const legacy: Record<string, unknown> = { ...publicPayload };
    delete legacy.checklist_items;
    legacy.tasks = publicPayload.tasks.map((task) => {
      const copy: Record<string, unknown> = { ...task };
      delete copy.checklist_item_count;
      delete copy.checklist_done_count;
      return copy;
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, legacy));

    await board.load('p1', undefined, { readonly: true });

    expect(board.error).toBeNull();
    expect(board.taskChecklists['t1']).toEqual([]);
    expect(board.tasks.map((t) => t.checklist_item_count)).toEqual([0, 0]);
    expect(board.tasks.map((t) => t.checklist_done_count)).toEqual([0, 0]);
  });
});

describe('board store mutations', () => {
  beforeEach(async () => {
    await board.load('p1');
    fetchMock.mockClear();
  });

  it('moveTask applies optimistically and sends exactly one PATCH', async () => {
    await board.moveTask('t1', 'c2', { sort_key: 'V3000' });

    const moved = board.tasks.find((t) => t.id === 't1');
    expect(moved?.column_id).toBe('c2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestAt(0);
    expect(request.method).toBe('PATCH');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t1');
    expect(await request.json()).toEqual({
      column_id: 'c2',
      sort_key: expect.any(String),
    });
  });

  it('moveTask failure toasts the error and refetches the board', async () => {
    mockRoutes((request) =>
      request.method === 'PATCH' ? jsonResponse(422, { error: 'nope' }) : undefined
    );

    await board.moveTask('t1', 'c2', { sort_key: 'V3000' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(1).method).toBe('GET');
    const reverted = board.tasks.find((t) => t.id === 't1');
    expect(reverted?.column_id).toBe('c1');
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('createTask appends at the end of the column and POSTs the sort key', async () => {
    await board.createTask('c1', 'New task');

    const created = board.tasks.find((t) => t.title === 'New task');
    expect(created?.column_id).toBe('c1');
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2', created?.id]);
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks');
    expect(await request.json()).toEqual({
      id: created?.id,
      project_id: 'p1',
      column_id: 'c1',
      title: 'New task',
      sort_key: expect.any(String),
    });
  });

  it('createTask adopts created_at and updated_at from the response', async () => {
    await board.createTask('c1', 'New task');

    const created = board.tasks.find((t) => t.title === 'New task');
    expect(created?.created_at).toBe(SERVER_CREATED_AT);
    expect(created?.updated_at).toBe(SERVER_UPDATED_AT);
  });

  it('createTasks appends the titles in order and sends one batch request', async () => {
    const ids = await board.createTasks('c1', ['X', 'Y']);

    expect(board.tasksInColumn('c1').map((t) => t.title)).toEqual(['A', 'B', 'X', 'Y']);
    expect(ids).toEqual(
      board
        .tasksInColumn('c1')
        .slice(2)
        .map((t) => t.id)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks/batch');
    expect(await request.json()).toEqual({
      project_id: 'p1',
      column_id: 'c1',
      tasks: [
        { id: ids![0], title: 'X', sort_key: expect.any(String) },
        { id: ids![1], title: 'Y', sort_key: expect.any(String) },
      ],
    });
  });

  it('createTasks adopts created_at and updated_at from the response', async () => {
    await board.createTasks('c1', ['X', 'Y']);

    for (const title of ['X', 'Y']) {
      const created = board.tasks.find((t) => t.title === title);
      expect(created?.created_at).toBe(SERVER_CREATED_AT);
      expect(created?.updated_at).toBe(SERVER_UPDATED_AT);
    }
  });

  it('createTasks inserts every card before the request resolves', async () => {
    const pending = board.createTasks('c1', ['X', 'Y', 'Z']);

    expect(board.tasksInColumn('c1').map((t) => t.title)).toEqual(['A', 'B', 'X', 'Y', 'Z']);
    await pending;
  });

  it('createTasks failure toasts, refetches, and returns null', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/tasks/batch'
        ? jsonResponse(422, { error: 'nope' })
        : undefined
    );

    const ids = await board.createTasks('c1', ['X', 'Y']);

    expect(ids).toBeNull();
    expect(board.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(1).method).toBe('GET');
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('createTasks is a no-op with no titles', async () => {
    const ids = await board.createTasks('c1', []);

    expect(ids).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toasts.toasts).toHaveLength(0);
    expect(board.tasks).toHaveLength(3);
  });

  it('createTasks is a no-op with no project loaded', async () => {
    board.reset();

    const ids = await board.createTasks('c1', ['X']);

    expect(ids).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toasts.toasts).toHaveLength(0);
  });

  it('createTasks refuses more than 100 titles without touching the board', async () => {
    const titles = Array.from({ length: 101 }, (_, i) => `T${i}`);

    const ids = await board.createTasks('c1', titles);

    expect(ids).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(board.tasks).toHaveLength(3);
    expect(toasts.toasts).toHaveLength(1);
    expect(toasts.toasts[0]!.message).toContain('100');
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

  it('updateTask applies a due date before the response and sends it unguarded', async () => {
    const pending = board.updateTask('t1', { due_date: '2026-08-03' });

    expect(board.tasks.find((t) => t.id === 't1')?.due_date).toBe('2026-08-03');
    await pending;
    expect(await requestAt(0).json()).toEqual({ due_date: '2026-08-03' });
  });

  it('updateTask resyncs the board rather than rolling back a failed due date', async () => {
    mockRoutes((request) =>
      request.method === 'PATCH' ? jsonResponse(500, { error: 'boom' }) : undefined
    );

    const outcome = await board.updateTask('t1', { due_date: '2026-08-03' });

    expect(outcome).toEqual({ status: 'error' });
    expect(toasts.toasts.map((t) => t.message)).toEqual(['boom']);
    expect(requestAt(1).method).toBe('GET');
    expect(new URL(requestAt(1).url).pathname).toBe('/api/projects/p1');
    expect(board.tasks.find((t) => t.id === 't1')?.due_date).toBeNull();
  });

  it('markTaskDone appends the task to the first done column', () => {
    expect(board.markTaskDone('t1')).toBe(true);

    const moved = board.tasks.find((t) => t.id === 't1');
    expect(moved?.column_id).toBe('c2');
    expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1']);
  });

  it('markTaskDone declines and issues nothing when no column is done', () => {
    board.columns = board.columns.map((column) => ({ ...column, is_done: false }));

    expect(board.markTaskDone('t1')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it('duplicateTask inserts the copy below the source and POSTs the id and sort key', async () => {
    const id = await board.duplicateTask('t1');

    expect(id).not.toBeNull();
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', id, 't2']);
    const copy = board.tasks.find((t) => t.id === id);
    expect(copy?.title).toBe('A');
    expect(copy?.label_ids).toEqual(['l1']);
    expect(copy?.created_at).toBe(SERVER_CREATED_AT);
    expect(copy?.updated_at).toBe(SERVER_UPDATED_AT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t1/duplicate');
    expect(await request.json()).toEqual({ id, sort_key: expect.any(String) });
  });

  it('duplicateTask appends when the source is the last card in its column', async () => {
    const id = await board.duplicateTask('t2');

    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2', id]);
  });

  it('duplicateTask shows the copy before the response, without blockers or comments', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, blocker_ids: ['t3'], comment_count: 2, assignee_ids: ['u1'] } : t
    );

    const pending = board.duplicateTask('t1');

    const copy = board.tasksInColumn('c1')[1]!;
    expect(copy.id).not.toBe('t1');
    expect(copy.title).toBe('A');
    expect(copy.label_ids).toEqual(['l1']);
    expect(copy.assignee_ids).toEqual(['u1']);
    expect(copy.blocker_ids).toEqual([]);
    expect(copy.comment_count).toBe(0);

    await pending;
  });

  it('duplicateTask keeps a rename typed while the request was in flight', async () => {
    const pending = board.duplicateTask('t1');
    const copyId = board.tasksInColumn('c1')[1]!.id;

    board.tasks = board.tasks.map((t) => (t.id === copyId ? { ...t, title: 'Renamed' } : t));

    await pending;

    const copy = board.tasks.find((t) => t.id === copyId);
    expect(copy?.title).toBe('Renamed');
    // Untouched fields still come from the response, or the merge would be
    // preserving stale optimistic guesses rather than real edits.
    expect(copy?.created_at).toBe(SERVER_CREATED_AT);
    expect(copy?.updated_at).toBe(SERVER_UPDATED_AT);
  });

  it('duplicateTask shows a cover immediately and takes the server copy of it', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, cover_image_url: '/api/images/img1' } : t
    );

    const pending = board.duplicateTask('t1');

    // The source's URL stands in until the response lands: same picture, and the
    // copy's own image has no id yet.
    expect(board.tasksInColumn('c1')[1]!.cover_image_url).toBe('/api/images/img1');

    const id = await pending;
    expect(board.tasks.find((t) => t.id === id)?.cover_image_url).toBe(SERVER_COVER_IMAGE_URL);
  });

  it('duplicateTask failure toasts, resyncs, and drops the optimistic copy', async () => {
    mockRoutes((_request, url) =>
      url.pathname === '/api/tasks/t1/duplicate' ? jsonResponse(422, { error: 'nope' }) : undefined
    );

    const id = await board.duplicateTask('t1');

    expect(id).toBeNull();
    expect(board.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect(requestAt(1).method).toBe('GET');
    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
  });

  it('duplicateTask is a no-op for a task the board does not hold', async () => {
    const id = await board.duplicateTask('missing');

    expect(id).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('duplicateColumn shows the empty copy beside the source, then merges its cards', async () => {
    const pending = board.duplicateColumn('c1');

    expect(board.columns.map((c) => c.name)).toEqual(['Todo', 'Todo', 'Done', 'Empty']);
    const copyId = board.columns[1]!.id;
    expect(board.tasks.filter((t) => t.column_id === copyId)).toEqual([]);

    await pending;

    expect(board.tasksInColumn(copyId).map((t) => t.id)).toEqual(['copy-t1', 'copy-t2']);
    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/columns/c1/duplicate');
    expect(await request.json()).toEqual({
      id: copyId,
      sort_key: expect.any(String),
    });
  });

  it('duplicateColumn does not re-add a card a realtime echo already delivered', async () => {
    const pending = board.duplicateColumn('c1');
    const copyId = board.columns[1]!.id;

    board.applyRealtime(
      realtimeEvent('task_created', { ...task('copy-t1', copyId, 1000, 'A'), title: 'A' }, 'p1')
    );

    await pending;

    expect(board.tasks.filter((t) => t.id === 'copy-t1')).toHaveLength(1);
    expect(board.tasksInColumn(copyId).map((t) => t.id)).toEqual(['copy-t1', 'copy-t2']);
  });

  it('duplicateColumn drops its cards when the board moved to another project', async () => {
    const pending = board.duplicateColumn('c1');
    board.currentProjectId = 'p2';

    await pending;

    expect(board.tasks.some((t) => t.id.startsWith('copy-'))).toBe(false);
  });

  it('duplicateColumn failure toasts and refetches', async () => {
    mockRoutes((_request, url) =>
      url.pathname === '/api/columns/c1/duplicate'
        ? jsonResponse(500, { error: 'boom' })
        : undefined
    );

    await board.duplicateColumn('c1');

    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(requestAt(1).method).toBe('GET');
    expect(toasts.toasts.map((t) => t.message)).toEqual(['boom']);
  });

  it('deleteColumn moves tasks optimistically then applies the 200 moved_tasks positions', async () => {
    mockRoutes((request, url) =>
      request.method === 'DELETE' && url.pathname === '/api/columns/c1'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 4000, sort_key: 'V0000040001' },
              { id: 't2', column_id: 'c2', position: 5000, sort_key: 'V0000050001' },
            ],
          })
        : undefined
    );

    const pending = board.deleteColumn('c1', 'c2');

    expect(board.columns.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1', 't2']);

    await pending;

    expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1', 't2']);
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

  it('updateLabel rethrows a duplicate-name 409 after resyncing, without a toast', async () => {
    mockRoutes((request, url) =>
      request.method === 'PATCH' && url.pathname === '/api/labels/l1'
        ? jsonResponse(409, { error: 'Label name already in use' })
        : undefined
    );

    await expect(board.updateLabel('l1', { name: 'art' })).rejects.toThrow(
      'Label name already in use'
    );

    expect(toasts.toasts).toHaveLength(0);
  });

  // Why three writes cannot go through #sendOrFail. Each invalidates the activity
  // log BEFORE its failure check, and every failure handler refetches over the
  // network; taskActivity measures elapsed time since its last fetch to choose
  // between fetching now and arming a timer, so running the policy first changes
  // what it decides. Routing any of the three through the helper inverts that
  // order, and each case below then fails.
  describe.each([
    ['addBlocker', '/api/tasks/t1/blockers', () => board.addBlocker('t1', 't2')],
    ['addChecklistItem', '/api/checklist-items', () => board.addChecklistItem('t1', 'a task')],
    [
      'promoteChecklistItem',
      '/api/checklist-items/ci1/promote',
      () => board.promoteChecklistItem('t1', 'ci1'),
    ],
  ])('%s', (_name, failingPath, run) => {
    it('invalidates the activity log before the failure policy refetches', async () => {
      board.taskChecklists = {
        t1: [serverChecklistItem('a task', 'ci1', 0, false, 'V0')],
      };
      const order: string[] = [];
      const invalidate = vi.spyOn(taskActivity, 'invalidate').mockImplementation(() => {
        order.push('invalidate');
      });
      mockRoutes((request, url) => {
        if (request.method !== 'GET' && url.pathname === failingPath) {
          return jsonResponse(409, { error: CYCLE_ERROR });
        }
        if (request.method === 'GET') {
          order.push('refetch');
        }
        return undefined;
      });

      await run();
      // Restored here, not in an afterEach: the activity-refresh cases further
      // down this file assert on the real invalidate.
      invalidate.mockRestore();

      expect(order[0]).toBe('invalidate');
      expect(order).toContain('refetch');
    });
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
  const PROJECT_ID = testUuid('p1');
  const TASK_ID = testUuid('t1');
  const BOARD_PATH = projectHref(PROJECT_ID, 'Game');
  const TASK_PATH = taskHref(TASK_ID, 'A');

  // Every id in this block reaches the address bar through encodeId, which takes
  // uuids only.
  function aliasPayload(): BoardPayload {
    const base = payload();
    return {
      ...base,
      project: { ...base.project, id: PROJECT_ID },
      tasks: base.tasks.map((t) => (t.id === 't1' ? { ...t, id: TASK_ID } : t)),
    };
  }

  beforeEach(async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === `/api/projects/${PROJECT_ID}`
        ? jsonResponse(200, aliasPayload())
        : undefined
    );
    router.navigate(BOARD_PATH, { replace: true });
    await board.load(PROJECT_ID);
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

    expect(router.path).toBe(`${BOARD_PATH}?q=boss`);
    expect(window.history.length).toBe(historyBefore);
  });

  // Lagging the write would let the next click push an entry over an unfiltered one.
  it('writes every filter change straight through to the address bar', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    replaceState.mockClear();

    board.toggleLabelFilter('l1');
    expect(router.path).toBe(`${BOARD_PATH}?labels=l1`);

    board.setFilterQuery('boss');
    expect(router.path).toBe(`${BOARD_PATH}?labels=l1&q=boss`);
    expect(replaceState).toHaveBeenCalledTimes(2);
  });

  it('keeps the overlay path when a filter changes behind an open task', () => {
    router.navigate(TASK_PATH, { replace: true });

    board.toggleLabelFilter('l1');

    expect(router.path).toBe(`${TASK_PATH}?labels=l1`);
  });

  it('keeps writing behind an overlay for an archived task', () => {
    const archivedId = testUuid('t9');
    const archivedPath = taskHref(archivedId, 'Old');
    board.archivedTasks = [
      { ...task(archivedId, 'c1', 1500, 'Old'), archived_at: SERVER_ARCHIVED_AT },
    ];
    router.navigate(archivedPath, { replace: true });

    board.toggleLabelFilter('l1');

    expect(router.path).toBe(`${archivedPath}?labels=l1`);
  });

  it('leaves the address bar alone on a task URL this board does not hold', () => {
    const elsewhere = taskHref(testUuid('t-elsewhere'), 'Elsewhere');
    router.navigate(elsewhere, { replace: true });

    board.toggleLabelFilter('l1');

    expect(board.filterLabelIds).toEqual(['l1']);
    expect(router.path).toBe(elsewhere);
  });

  it('leaves query keys it does not own in the address bar', () => {
    router.navigate(`${TASK_PATH}?from=my-tasks`, { replace: true });

    board.setFilters(parseFilters('?from=my-tasks'));
    expect(router.path).toBe(`${TASK_PATH}?from=my-tasks`);

    board.toggleLabelFilter('l1');
    expect(router.path).toBe(`${TASK_PATH}?labels=l1&from=my-tasks`);

    board.clearFilters();
    expect(router.path).toBe(`${TASK_PATH}?from=my-tasks`);
  });

  it('drops the query string again when the filters are cleared', () => {
    board.setFilterQuery('boss');
    expect(router.path).toBe(`${BOARD_PATH}?q=boss`);

    board.clearFilters();

    expect(router.path).toBe(BOARD_PATH);
  });

  it('rewrites a hand-ordered query string into the canonical one', () => {
    router.navigate(`${BOARD_PATH}?q=boss&labels=l1`, { replace: true });

    board.setFilters(parseFilters('?q=boss&labels=l1'));

    expect(router.path).toBe(`${BOARD_PATH}?labels=l1&q=boss`);
  });

  it('drops a label the project does not have from an already-unfiltered address bar', () => {
    router.navigate(`${BOARD_PATH}?labels=l-gone`, { replace: true });

    board.setFilters(parseFilters('?labels=l-gone'));

    expect(board.hasActiveFilters).toBe(false);
    expect(router.path).toBe(BOARD_PATH);
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
    expect(router.path).toBe(`${BOARD_PATH}?labels=l1&q=alpha`);

    await board.deleteLabel('l1');

    expect(board.filterLabelIds).toEqual([]);
    expect(router.path).toBe(`${BOARD_PATH}?q=alpha`);
  });

  it('prunes a label another member deleted from the query string', () => {
    board.toggleLabelFilter('l1');
    expect(router.path).toBe(`${BOARD_PATH}?labels=l1`);

    board.applyRealtime(realtimeEvent('label_deleted', { id: 'l1' }, PROJECT_ID));

    expect(board.filterLabelIds).toEqual([]);
    expect(router.path).toBe(BOARD_PATH);
  });

  it('leaves the address bar alone while another route is showing', () => {
    const otherBoard = projectHref(testUuid('p2'), 'Other');
    router.navigate(otherBoard, { replace: true });

    board.toggleLabelFilter('l1');

    expect(board.filterLabelIds).toEqual(['l1']);
    expect(router.path).toBe(otherBoard);
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

describe('sortColumn', () => {
  beforeEach(() => {
    board.currentProjectId = 'p1';
    board.tasks = [
      {
        ...task('t1', 'c1', 1000, 'Cherry'),
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        column_since: '2026-01-01T00:00:00Z',
      },
      {
        ...task('t2', 'c1', 2000, 'Apple'),
        created_at: '2026-02-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
        column_since: '2026-04-01T00:00:00Z',
      },
      {
        ...task('t3', 'c1', 3000, 'Banana'),
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        column_since: '2026-02-01T00:00:00Z',
      },
    ];
  });

  it('rewrites sort keys to match the sort, one-shot', async () => {
    await board.sortColumn('c1', 'title-asc');

    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t2', 't3', 't1']);
    // The whole column is re-stamped, not just the cards that moved.
    const keys = board.tasksInColumn('c1').map((t) => t.sort_key);
    expect([...keys].sort()).toEqual(keys);
  });

  it('posts the ordered ids to the reorder endpoint', async () => {
    await board.sortColumn('c1', 'created-desc');

    const reorderCall = fetchMock.mock.calls.find((call) =>
      new URL((call[0] as Request).url).pathname.endsWith('/c1/reorder')
    );
    expect(reorderCall).toBeTruthy();
    const body = (await (reorderCall![0] as Request).clone().json()) as { task_ids: string[] };
    expect(body.task_ids).toEqual(['t3', 't2', 't1']);
  });

  it('is a no-op for a column with one task', async () => {
    board.tasks = [task('solo', 'c1', 7777, 'Only')];

    await board.sortColumn('c1', 'title-asc');

    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['solo']);
    expect(
      fetchMock.mock.calls.some((call) =>
        new URL((call[0] as Request).url).pathname.endsWith('/c1/reorder')
      )
    ).toBe(false);
  });

  it('toasts the error and refetches when the reorder fails', async () => {
    mockRoutes((_request, url) =>
      url.pathname === '/api/columns/c1/reorder' ? jsonResponse(422, { error: 'nope' }) : undefined
    );

    await board.sortColumn('c1', 'title-asc');

    expect(toasts.toasts.map((t) => t.message)).toEqual(['nope']);
    expect(requestAt(1).method).toBe('GET');
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
    board.archivedTasks = [{ ...archivedTask('t9', 'c1', 'Old'), sort_key: 'V0000015001' }];
    mockRoutes((request, url) =>
      request.method === 'DELETE' && url.pathname === '/api/columns/c1'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 4000, sort_key: 'V0000040001' },
              { id: 't9', column_id: 'c2', position: 5000, sort_key: 'V0000050001' },
              { id: 't2', column_id: 'c2', position: 6000, sort_key: 'V0000060001' },
            ],
          })
        : undefined
    );

    // t1, t9 and t2 relocate in rank order after t3.
    const pending = board.deleteColumn('c1', 'c2');
    expect(board.archivedTasks[0]).toMatchObject({ column_id: 'c2' });
    await pending;
    expect(board.archivedTasks[0]).toMatchObject({ column_id: 'c2', sort_key: 'V0000050001' });

    board.archivedTasks = [archivedTask('t8', 'c3', 'Gone')];
    await board.deleteColumn('c3');
    expect(board.archivedTasks).toEqual([]);
  });

  it('applyRealtime task_archived moves the card into the archive without duplicating it', () => {
    board.tasks = board.tasks.map((t) => (t.id === 't2' ? { ...t, blocker_ids: ['t1'] } : t));
    const event = realtimeEvent('task_archived', archivedTask('t1'), 'p1');

    board.applyRealtime(event);
    board.applyRealtime(event);

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    expect(board.tasks.find((t) => t.id === 't2')?.blocker_ids).toEqual([]);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
  });

  // The open card names its recurrence from this record, so a series edited or
  // deleted elsewhere must not leave it quoting a rule that is gone.
  function monday(id: string): TaskSeriesRef {
    return { id, summary: 'Every Monday', preset: 'weekly', start_date: '2026-02-02' };
  }

  // Not just the wording: the card's panel preselects from `preset` and labels
  // its options from `start_date`, so a rule edited elsewhere has to replace all
  // three or the card describes the new rule while editing the old one.
  it('applySeriesRealtime re-words a card whose rule was edited', () => {
    board.setTaskSeriesRef('t1', monday('s1'));
    board.setTaskSeriesRef('t2', monday('s2'));

    board.applySeriesRealtime(
      realtimeEvent(
        'series_updated',
        { id: 's1', summary: 'Every Tuesday', preset: 'daily', start_date: '2026-03-03' },
        'p1'
      )
    );

    expect(board.taskSeriesRefs['t1']).toEqual({
      id: 's1',
      summary: 'Every Tuesday',
      preset: 'daily',
      start_date: '2026-03-03',
    });
    expect(board.taskSeriesRefs['t2']).toEqual(monday('s2'));
  });

  it('applySeriesRealtime stops naming a series that was deleted', () => {
    board.setTaskSeriesRef('t1', monday('s1'));
    board.setTaskSeriesRef('t2', monday('s2'));

    board.applySeriesRealtime(realtimeEvent('series_deleted', { id: 's1' }, 'p1'));

    expect(board.taskSeriesRefs['t1']).toBeNull();
    expect(board.taskSeriesRefs['t2']).toEqual(monday('s2'));
  });

  it('applyRealtime task_restored moves the card back onto the board', () => {
    board.applyRealtime(realtimeEvent('task_archived', archivedTask('t1'), 'p1'));
    board.applyRealtime(realtimeEvent('task_restored', task('t1', 'c1', 1000, 'A'), 'p1'));

    expect(board.archivedTasks).toEqual([]);
    expect(board.tasks.some((t) => t.id === 't1')).toBe(true);
  });

  it('applyRealtime task_deleted and column_deleted keep the archive consistent', () => {
    board.archivedTasks = [archivedTask('t8'), archivedTask('t9')];

    board.applyRealtime(realtimeEvent('task_deleted', { id: 't8' }, 'p1'));
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t9']);

    board.applyRealtime(
      realtimeEvent(
        'column_deleted',
        {
          id: 'c1',
          moved_tasks: [{ id: 't9', column_id: 'c2', sort_key: 'V0000070001' }],
        },
        'p1'
      )
    );
    expect(board.archivedTasks).toEqual([
      expect.objectContaining({
        id: 't9',
        column_id: 'c2',
        sort_key: 'V0000070001',
      }),
    ]);

    board.archivedTasks = [archivedTask('t7', 'c2')];
    board.applyRealtime(realtimeEvent('column_deleted', { id: 'c2', moved_tasks: [] }, 'p1'));
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

describe('column bulk actions', () => {
  function archivedTask(id: string, columnId = 'c1', title = 'A') {
    return { ...task(id, columnId, 1000, title), archived_at: SERVER_ARCHIVED_AT };
  }

  function pathsRequested(): string[] {
    return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
  }

  // t1 sits in c1 and is blocked by t3 in c2, so archiving c2 has a dependent.
  function blockedPayload(): BoardPayload {
    const base = payload();
    return {
      ...base,
      tasks: base.tasks.map((t) => (t.id === 't1' ? { ...t, blocker_ids: ['t3'] } : t)),
    };
  }

  beforeEach(async () => {
    await board.load('p1');
    fetchMock.mockClear();
  });

  it('moveTasksToColumn appends the cards optimistically and keeps every column', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/move-tasks'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 2000, sort_key: 'V0000020001' },
              { id: 't2', column_id: 'c2', position: 3000, sort_key: 'V0000030001' },
            ],
          })
        : undefined
    );

    const pending = board.moveTasksToColumn('c1', 'c2');

    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    expect(board.tasksInColumn('c1')).toEqual([]);

    await pending;

    const request = requestAt(0);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/columns/c1/move-tasks');
    expect(await request.json()).toEqual({ target_column_id: 'c2' });
    expect(pathsRequested()).toEqual(['/api/columns/c1/move-tasks']);
    expect(board.tasksInColumn('c1')).toEqual([]);
  });

  it('moveTasksToColumn adopts the positions the server sent back', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/move-tasks'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 8000, sort_key: 'V0000080001' },
              { id: 't2', column_id: 'c2', position: 9000, sort_key: 'V0000090001' },
            ],
          })
        : undefined
    );

    await board.moveTasksToColumn('c1', 'c2');

    expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1', 't2']);
    expect(pathsRequested()).toEqual(['/api/columns/c1/move-tasks']);
  });

  it('moveTasksToColumn resyncs when the server moved fewer cards than we did', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/move-tasks'
        ? jsonResponse(200, {
            moved_tasks: [{ id: 't1', column_id: 'c2', position: 8000, sort_key: 'V0000080001' }],
          })
        : undefined
    );

    await board.moveTasksToColumn('c1', 'c2');

    expect(pathsRequested()).toEqual(['/api/columns/c1/move-tasks', '/api/projects/p1']);
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('moveTasksToColumn resyncs when the server moved a card we did not send', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/move-tasks'
        ? jsonResponse(200, {
            moved_tasks: [
              { id: 't1', column_id: 'c2', position: 8000, sort_key: 'V0000080001' },
              { id: 't9', column_id: 'c2', position: 9000, sort_key: 'V0000090001' },
            ],
          })
        : undefined
    );

    await board.moveTasksToColumn('c1', 'c2');

    expect(pathsRequested()).toEqual(['/api/columns/c1/move-tasks', '/api/projects/p1']);
  });

  it('moveTasksToColumn toasts and resyncs on failure', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/move-tasks'
        ? jsonResponse(500, { error: 'boom' })
        : undefined
    );

    await board.moveTasksToColumn('c1', 'c2');

    expect(toasts.toasts.map((t) => t.message)).toContain('boom');
    expect(pathsRequested()).toContain('/api/projects/p1');
  });

  it('moveTasksToColumn on an empty column issues no request', async () => {
    await board.moveTasksToColumn('c3', 'c1');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('archiveTasksInColumn drops the cards, strips their blocker edges, and archives them', async () => {
    mockRoutes((request, url) => {
      if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
        return jsonResponse(200, blockedPayload());
      }
      if (request.method === 'POST' && url.pathname === '/api/columns/c2/archive-tasks') {
        return jsonResponse(200, { tasks: [archivedTask('t3', 'c2', 'C')] });
      }
      return undefined;
    });
    await board.refetch();
    fetchMock.mockClear();
    expect(board.tasks.find((t) => t.id === 't1')?.blocker_ids).toEqual(['t3']);

    await board.archiveTasksInColumn('c2');

    expect(board.tasks.some((t) => t.id === 't3')).toBe(false);
    expect(board.tasks.find((t) => t.id === 't1')?.blocker_ids).toEqual([]);
    expect(board.archivedTasks.map((t) => [t.id, t.archived_at])).toEqual([
      ['t3', SERVER_ARCHIVED_AT],
    ]);
    expect(pathsRequested()).toEqual(['/api/columns/c2/archive-tasks']);
  });

  it('archiveTasksInColumn resyncs when the response covers a different set', async () => {
    board.archivedLoaded = true;
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/archive-tasks'
        ? jsonResponse(200, { tasks: [archivedTask('t1', 'c1', 'A')] })
        : undefined
    );

    await board.archiveTasksInColumn('c1');

    expect(pathsRequested()).toEqual([
      '/api/columns/c1/archive-tasks',
      '/api/projects/p1',
      '/api/projects/p1/archived-tasks',
    ]);
  });

  it('archiveTasksInColumn resyncs when the response swaps one card for another', async () => {
    board.archivedLoaded = true;
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c1/archive-tasks'
        ? jsonResponse(200, {
            tasks: [archivedTask('t1', 'c1', 'A'), archivedTask('t9', 'c1', 'Z')],
          })
        : undefined
    );

    await board.archiveTasksInColumn('c1');

    expect(pathsRequested()).toEqual([
      '/api/columns/c1/archive-tasks',
      '/api/projects/p1',
      '/api/projects/p1/archived-tasks',
    ]);
  });

  it('archiveTasksInColumn clears the provisional rows and resyncs on failure', async () => {
    board.archivedLoaded = true;
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/columns/c2/archive-tasks'
        ? jsonResponse(500, { error: 'boom' })
        : undefined
    );

    await board.archiveTasksInColumn('c2');

    expect(board.archivedTasks).toEqual([]);
    expect(toasts.toasts.map((t) => t.message)).toContain('boom');
    expect(pathsRequested()).toContain('/api/projects/p1');
    expect(pathsRequested()).toContain('/api/projects/p1/archived-tasks');
  });

  it('archiveTasksInColumn on an empty column issues no request', async () => {
    await board.archiveTasksInColumn('c3');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(board.archivedTasks).toEqual([]);
  });

  it('applyRealtime column_tasks_moved relocates the listed cards and keeps the columns', () => {
    board.applyRealtime(
      realtimeEvent(
        'column_tasks_moved',
        {
          column_id: 'c1',
          target_column_id: 'c2',
          moved_tasks: [
            { id: 't1', column_id: 'c2', sort_key: 'V0000040001' },
            { id: 't2', column_id: 'c2', sort_key: 'V0000050001' },
          ],
        },
        'p1'
      )
    );

    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1', 't2']);
  });

  it('applyRealtime column_tasks_archived drops the cards once, even on a self-echo', async () => {
    mockRoutes((request, url) =>
      request.method === 'GET' && url.pathname === '/api/projects/p1'
        ? jsonResponse(200, blockedPayload())
        : undefined
    );
    await board.refetch();
    const event = realtimeEvent(
      'column_tasks_archived',
      { column_id: 'c2', tasks: [archivedTask('t3', 'c2', 'C')] },
      'p1'
    );

    board.applyRealtime(event);
    board.applyRealtime(event);

    expect(board.tasks.some((t) => t.id === 't3')).toBe(false);
    expect(board.tasks.find((t) => t.id === 't1')?.blocker_ids).toEqual([]);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t3']);
  });

  it('ignores both bulk events aimed at another project', () => {
    board.applyRealtime(
      realtimeEvent(
        'column_tasks_moved',
        {
          column_id: 'c1',
          target_column_id: 'c2',
          moved_tasks: [{ id: 't1', column_id: 'c2', sort_key: 'V0000040001' }],
        },
        'p2'
      )
    );
    board.applyRealtime(
      realtimeEvent(
        'column_tasks_archived',
        { column_id: 'c2', tasks: [archivedTask('t3', 'c2', 'C')] },
        'p2'
      )
    );

    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2']);
    expect(board.tasks.some((t) => t.id === 't3')).toBe(true);
    expect(board.archivedTasks).toEqual([]);
  });
});

describe('selection bulk actions', () => {
  const ME = 'u-me';

  function archivedTask(id: string, columnId = 'c1', title = 'A') {
    return { ...task(id, columnId, 1000, title), archived_at: SERVER_ARCHIVED_AT };
  }

  function relations(taskId: string, labelIds: string[], assigneeIds: string[] = []) {
    return {
      task_id: taskId,
      label_ids: labelIds,
      assignee_ids: assigneeIds,
      blocker_ids: [],
      open_cross_project_blocker_count: 0,
    };
  }

  function pathsRequested(): string[] {
    return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
  }

  function answer(path: string, body: unknown): void {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === path ? jsonResponse(200, body) : undefined
    );
  }

  beforeEach(async () => {
    await board.load('p1');
    session.user = {
      id: ME,
      name: 'Ada',
      email: 'ada@example.com',
      avatar_url: null,
      email_verified: false,
    };
    board.project = { ...board.project!, created_by: ME };
    selection.clear();
    fetchMock.mockClear();
  });

  describe('bulkMoveTasks', () => {
    it('appends in the order it was given and adopts the server positions', async () => {
      answer('/api/tasks/bulk-move', {
        moved_tasks: [
          { id: 't2', column_id: 'c2', position: 7000, sort_key: 'V0000070001' },
          { id: 't1', column_id: 'c2', position: 8000, sort_key: 'V0000080001' },
        ],
        skipped_task_ids: [],
      });

      const pending = board.bulkMoveTasks(['t2', 't1'], 'c2');

      expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't2', 't1']);

      await pending;

      expect(await requestAt(0).json()).toEqual({
        project_id: 'p1',
        task_ids: ['t2', 't1'],
        column_id: 'c2',
      });
      expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't2', 't1']);
      expect(pathsRequested()).toEqual(['/api/tasks/bulk-move']);
    });

    it('names the counts and resyncs when the server skipped a card', async () => {
      answer('/api/tasks/bulk-move', {
        moved_tasks: [{ id: 't1', column_id: 'c2', position: 7000, sort_key: 'V0000070001' }],
        skipped_task_ids: ['t2'],
      });

      await board.bulkMoveTasks(['t1', 't2'], 'c2');

      expect(toasts.toasts.map((t) => t.message)).toContain(
        'Moved 1 of 2 cards. 1 changed before the action ran.'
      );
      expect(pathsRequested()).toEqual(['/api/tasks/bulk-move', '/api/projects/p1']);
    });

    it('resyncs when the server moved a card we did not send', async () => {
      answer('/api/tasks/bulk-move', {
        moved_tasks: [
          { id: 't1', column_id: 'c2', position: 7000, sort_key: 'V0000070001' },
          { id: 't9', column_id: 'c2', position: 8000, sort_key: 'V0000080001' },
        ],
        skipped_task_ids: [],
      });

      await board.bulkMoveTasks(['t1'], 'c2');

      expect(pathsRequested()).toEqual(['/api/tasks/bulk-move', '/api/projects/p1']);
    });

    it('toasts and resyncs on failure', async () => {
      mockRoutes((request, url) =>
        request.method === 'POST' && url.pathname === '/api/tasks/bulk-move'
          ? jsonResponse(500, { error: 'boom' })
          : undefined
      );

      await board.bulkMoveTasks(['t1'], 'c2');

      expect(toasts.toasts.map((t) => t.message)).toContain('boom');
      expect(pathsRequested()).toContain('/api/projects/p1');
    });

    it('issues no request for an empty selection', async () => {
      await board.bulkMoveTasks([], 'c2');

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('bulkArchiveTasks', () => {
    it('drops the cards, strips their blocker edges, and adopts the server rows', async () => {
      board.tasks = board.tasks.map((t) => (t.id === 't2' ? { ...t, blocker_ids: ['t1'] } : t));
      answer('/api/tasks/bulk-archive', {
        tasks: [archivedTask('t1', 'c1', 'A')],
        skipped_task_ids: [],
      });

      await board.bulkArchiveTasks(['t1']);

      expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
      expect(board.tasks.find((t) => t.id === 't2')?.blocker_ids).toEqual([]);
      expect(board.archivedTasks.map((t) => [t.id, t.archived_at])).toEqual([
        ['t1', SERVER_ARCHIVED_AT],
      ]);
      expect(await requestAt(0).json()).toEqual({ project_id: 'p1', task_ids: ['t1'] });
      expect(pathsRequested()).toEqual(['/api/tasks/bulk-archive']);
    });

    it('names the counts and resyncs when a card was already archived', async () => {
      board.archivedLoaded = true;
      answer('/api/tasks/bulk-archive', {
        tasks: [archivedTask('t1', 'c1', 'A')],
        skipped_task_ids: ['t2'],
      });

      await board.bulkArchiveTasks(['t1', 't2']);

      expect(toasts.toasts.map((t) => t.message)).toContain(
        'Archived 1 of 2 cards. 1 changed before the action ran.'
      );
      expect(pathsRequested()).toEqual([
        '/api/tasks/bulk-archive',
        '/api/projects/p1',
        '/api/projects/p1/archived-tasks',
      ]);
    });

    it('clears the provisional rows and resyncs on failure', async () => {
      mockRoutes((request, url) =>
        request.method === 'POST' && url.pathname === '/api/tasks/bulk-archive'
          ? jsonResponse(500, { error: 'boom' })
          : undefined
      );

      await board.bulkArchiveTasks(['t1', 't2']);

      expect(board.archivedTasks).toEqual([]);
      expect(toasts.toasts.map((t) => t.message)).toContain('boom');
      expect(pathsRequested()).toContain('/api/projects/p1');
    });
  });

  describe('bulkSetLabel and bulkSetAssignee', () => {
    it('applies the label optimistically, sends only the add key, and reconciles', async () => {
      answer('/api/tasks/bulk-labels', {
        tasks: [relations('t2', ['l1'])],
        skipped_task_ids: [],
      });

      const pending = board.bulkSetLabel(['t1', 't2'], 'l1', true);

      expect(board.tasks.find((t) => t.id === 't2')?.label_ids).toEqual(['l1']);

      await pending;

      expect(await requestAt(0).json()).toEqual({
        project_id: 'p1',
        task_ids: ['t1', 't2'],
        add_label_ids: ['l1'],
      });
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toEqual(['l1']);
      expect(board.tasks.find((t) => t.id === 't2')?.label_ids).toEqual(['l1']);
      // t1 already carried the label, so the server reports it as unchanged and
      // that is not a skip.
      expect(pathsRequested()).toEqual(['/api/tasks/bulk-labels']);
    });

    it('sends only the remove key when turning a label off', async () => {
      answer('/api/tasks/bulk-labels', {
        tasks: [relations('t1', [])],
        skipped_task_ids: [],
      });

      await board.bulkSetLabel(['t1'], 'l1', false);

      expect(await requestAt(0).json()).toEqual({
        project_id: 'p1',
        task_ids: ['t1'],
        remove_label_ids: ['l1'],
      });
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toEqual([]);
    });

    it('applies an assignee across the selection', async () => {
      answer('/api/tasks/bulk-assignees', {
        tasks: [relations('t1', ['l1'], [ME]), relations('t2', [], [ME])],
        skipped_task_ids: [],
      });

      const pending = board.bulkSetAssignee(['t1', 't2'], ME, true);

      expect(board.tasks.find((t) => t.id === 't2')?.assignee_ids).toEqual([ME]);

      await pending;

      expect(await requestAt(0).json()).toEqual({
        project_id: 'p1',
        task_ids: ['t1', 't2'],
        add_user_ids: [ME],
      });
      expect(board.tasks.find((t) => t.id === 't1')?.assignee_ids).toEqual([ME]);
      expect(pathsRequested()).toEqual(['/api/tasks/bulk-assignees']);
    });

    it('names the counts and resyncs when a card was skipped', async () => {
      answer('/api/tasks/bulk-labels', {
        tasks: [relations('t1', ['l1'])],
        skipped_task_ids: ['t2'],
      });

      await board.bulkSetLabel(['t1', 't2'], 'l1', true);

      expect(toasts.toasts.map((t) => t.message)).toContain(
        'Updated 1 of 2 cards. 1 changed before the action ran.'
      );
      expect(pathsRequested()).toEqual(['/api/tasks/bulk-labels', '/api/projects/p1']);
    });

    it('resyncs when the response names a card we did not send', async () => {
      answer('/api/tasks/bulk-labels', {
        tasks: [relations('t1', ['l1']), relations('t9', ['l1'])],
        skipped_task_ids: [],
      });

      await board.bulkSetLabel(['t1'], 'l1', true);

      expect(pathsRequested()).toEqual(['/api/tasks/bulk-labels', '/api/projects/p1']);
    });

    it('toasts and resyncs on failure', async () => {
      mockRoutes((request, url) =>
        request.method === 'POST' && url.pathname === '/api/tasks/bulk-labels'
          ? jsonResponse(500, { error: 'boom' })
          : undefined
      );

      await board.bulkSetLabel(['t1'], 'l1', true);

      expect(toasts.toasts.map((t) => t.message)).toContain('boom');
      expect(pathsRequested()).toContain('/api/projects/p1');
    });
  });

  describe('applyRealtime', () => {
    it('bulk_tasks_moved relocates the cards and leaves the selection standing', () => {
      selection.toggle('t1');

      board.applyRealtime(
        realtimeEvent(
          'bulk_tasks_moved',
          {
            moved_tasks: [{ id: 't1', column_id: 'c2', sort_key: 'V0000040001' }],
          },
          'p1'
        )
      );

      expect(board.tasksInColumn('c2').map((t) => t.id)).toEqual(['t3', 't1']);
      expect(selection.selectedIds).toEqual(['t1']);
    });

    it('bulk_tasks_archived takes the cards off the board and into the archive', () => {
      board.applyRealtime(
        realtimeEvent('bulk_tasks_archived', { tasks: [archivedTask('t1', 'c1', 'A')] }, 'p1')
      );

      expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
      expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
    });

    it('bulk_tasks_relations_set rewrites only the cards it names', () => {
      board.applyRealtime(
        realtimeEvent('bulk_tasks_relations_set', { tasks: [relations('t2', ['l1'], [ME])] }, 'p1')
      );

      expect(board.tasks.find((t) => t.id === 't2')?.label_ids).toEqual(['l1']);
      expect(board.tasks.find((t) => t.id === 't2')?.assignee_ids).toEqual([ME]);
      expect(board.tasks.find((t) => t.id === 't1')?.label_ids).toEqual(['l1']);
    });

    it('ignores every bulk event aimed at another project', () => {
      board.applyRealtime(
        realtimeEvent('bulk_tasks_archived', { tasks: [archivedTask('t1', 'c1', 'A')] }, 'p2')
      );

      expect(board.tasks.some((t) => t.id === 't1')).toBe(true);
      expect(board.archivedTasks).toEqual([]);
    });
  });
});

describe('applyRealtime does not resurrect a deleted task', () => {
  beforeEach(async () => {
    await board.load('p1');
  });

  it('ignores a stale task_updated echo for a task that was just deleted', async () => {
    await board.deleteTask('t1');
    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);

    board.applyRealtime(
      realtimeEvent('task_updated', { ...task('t1', 'c1', 1000, 'A'), title: 'A edited' }, 'p1')
    );

    expect(board.tasks.some((t) => t.id === 't1')).toBe(false);
    const result = computeGraph(board.tasks, board.columns);
    if (result.kind === 'ok') {
      expect(result.layout.nodes.some((n) => n.id === 't1')).toBe(false);
    }
  });

  it('still applies a task_updated echo for a task that is present', () => {
    board.applyRealtime(
      realtimeEvent('task_updated', { ...task('t2', 'c1', 2000, 'B'), title: 'B renamed' }, 'p1')
    );

    expect(board.tasks.find((t) => t.id === 't2')?.title).toBe('B renamed');
  });
});

describe('applyRealtime project_updated', () => {
  beforeEach(async () => {
    await board.load('p1');
    board.project = {
      ...board.project!,
      created_by: 'u-owner',
      member_ids: ['u-me'],
      members: [{ user_id: 'u-me', role: 'editor' }],
      color: 'amber',
    };
  });

  it('adopts a rename that carries nothing else, leaving membership as it was', () => {
    board.applyRealtime(realtimeEvent('project_updated', { id: 'p1', name: 'Renamed' }, 'p1'));

    expect(board.project?.name).toBe('Renamed');
    expect(board.project?.created_by).toBe('u-owner');
    expect(board.project?.member_ids).toEqual(['u-me']);
    expect(board.project?.members).toEqual([{ user_id: 'u-me', role: 'editor' }]);
  });

  it('leaves the name alone when the event carries only membership', () => {
    board.applyRealtime(
      realtimeEvent(
        'project_updated',
        { id: 'p1', member_ids: ['u-me'], members: [{ user_id: 'u-me', role: 'viewer' }] },
        'p1'
      )
    );

    expect(board.project?.name).toBe('Game');
    expect(board.project?.members).toEqual([{ user_id: 'u-me', role: 'viewer' }]);
  });

  it("adopts a teammate's color change", () => {
    board.applyRealtime(realtimeEvent('project_updated', { id: 'p1', color: 'sky' }, 'p1'));

    expect(board.project?.color).toBe('sky');
  });

  it('clears the color when the event carries an explicit null', () => {
    board.applyRealtime(realtimeEvent('project_updated', { id: 'p1', color: null }, 'p1'));

    expect(board.project?.color).toBeNull();
  });

  it('keeps the color when the event has no color at all', () => {
    board.applyRealtime(realtimeEvent('project_updated', { id: 'p1', name: 'Renamed' }, 'p1'));

    expect(board.project?.color).toBe('amber');
  });
});

describe('board store cover images', () => {
  const cover: TaskAttachment = {
    id: 'img1',
    task_id: 't1',
    kind: 'image',
    image_url: '/api/images/img1',
    is_cover: false,
    title: null,
    description: null,
    filename: 'shot.png',
    content_type: 'image/png',
    size_bytes: 4,
    url: null,
    preview_url: null,
    favicon_url: null,
    unfurl_state: null,
    created_at: SERVER_CREATED_AT,
    updated_at: SERVER_CREATED_AT,
  };
  const other: TaskAttachment = {
    ...cover,
    id: 'img2',
    image_url: '/api/images/img2',
    filename: 'other.png',
  };

  beforeEach(async () => {
    await board.load('p1');
    board.taskAttachments = { t1: [cover, other] };
    fetchMock.mockClear();
  });

  function coverOf(taskId: string): string | null | undefined {
    return board.tasks.find((t) => t.id === taskId)?.cover_image_url;
  }

  it('setTaskCover applies the url before the request resolves and PUTs the image id', async () => {
    const pending = board.setTaskCover('t1', cover);

    expect(coverOf('t1')).toBe('/api/images/img1');
    await pending;
    const request = requestAt(0);
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).pathname).toBe('/api/tasks/t1/cover');
    expect(await request.json()).toEqual({ image_id: 'img1' });
  });

  it('setTaskCover clears the card and sends a null image_id', async () => {
    await board.setTaskCover('t1', cover);
    fetchMock.mockClear();

    await board.setTaskCover('t1', null);

    expect(coverOf('t1')).toBeNull();
    expect(await requestAt(0).json()).toEqual({ image_id: null });
  });

  // The label is what the unsynced-changes panel shows for a queued write, and
  // clearing a cover passes null — never undefined, which is what the label used
  // to test for and so never said "Removed".
  it('setTaskCover names clearing a cover as a removal, not as setting one', async () => {
    const submit = vi.spyOn(outbox, 'submit');

    await board.setTaskCover('t1', cover);
    expect(submit.mock.calls[0]?.[0].label).toBe('Set a cover image');

    submit.mockClear();
    await board.setTaskCover('t1', null);
    expect(submit.mock.calls[0]?.[0].label).toBe('Removed a cover image');

    submit.mockRestore();
  });

  it('setTaskCover toasts and refetches the board when the request fails', async () => {
    mockRoutes((request, url) =>
      request.method === 'PUT' && url.pathname === '/api/tasks/t1/cover'
        ? jsonResponse(404, { error: 'Task not found' })
        : undefined
    );

    await board.setTaskCover('t1', cover);

    expect(toasts.toasts.map((t) => t.message)).toContain('Task not found');
    expect(requestAt(1).method).toBe('GET');
    expect(coverOf('t1')).toBeNull();
  });

  it('createTask starts a task with no cover', async () => {
    await board.createTask('c1', 'New task');

    expect(board.tasks.find((t) => t.title === 'New task')?.cover_image_url).toBeNull();
  });

  it('deleting the cover attachment clears the cover without waiting for a refetch', async () => {
    await board.setTaskCover('t1', cover);
    fetchMock.mockClear();

    const pending = board.deleteAttachment('t1', 'img1');

    expect(coverOf('t1')).toBeNull();
    await pending;
  });

  it('deleting another attachment leaves the cover in place', async () => {
    await board.setTaskCover('t1', cover);
    fetchMock.mockClear();

    await board.deleteAttachment('t1', 'img2');

    expect(coverOf('t1')).toBe('/api/images/img1');
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

  it('loadTaskDetail heals the cached counts and cover from the detail payload', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, comment_count: 7, cover_image_url: '/api/images/gone' } : t
    );

    await board.loadTaskDetail('t1');

    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(1);
    expect(board.tasks.find((t) => t.id === 't1')?.cover_image_url).toBeNull();
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
    board.applyRealtime(
      realtimeEvent(
        'comment_created',
        { ...serverComment('from a teammate', 'cm9'), comment_count: 1 },
        'p1'
      )
    );

    expect(board.taskComments.t1!.map((c) => c.id)).toEqual(['cm9']);
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(1);

    board.applyRealtime(
      realtimeEvent(
        'comment_created',
        { ...serverComment('from a teammate', 'cm9'), comment_count: 1 },
        'p1'
      )
    );

    expect(board.taskComments.t1).toHaveLength(1);
  });

  it('applyRealtime keeps the cached stream chronological regardless of arrival order', () => {
    for (const [id, at] of [
      ['late', '2026-06-01T00:00:00Z'],
      ['early', '2026-01-01T00:00:00Z'],
    ] as const) {
      board.applyRealtime(
        realtimeEvent(
          'comment_created',
          { ...serverComment(id, id), created_at: at, updated_at: at, comment_count: 1 },
          'p1'
        )
      );
    }

    expect(board.taskComments.t1!.map((c) => c.id)).toEqual(['early', 'late']);
  });

  it('applyRealtime patches a comment_updated in place and removes a comment_deleted by id', () => {
    board.taskComments = { t1: [serverComment('before', 'cm1')] };

    board.applyRealtime(
      realtimeEvent(
        'comment_updated',
        { ...serverComment('after', 'cm1'), updated_at: SERVER_UPDATED_AT },
        'p1'
      )
    );

    expect(board.taskComments.t1![0]!.body).toEqual(commentBody('after'));
    expect(board.taskComments.t1![0]!.updated_at).toBe(SERVER_UPDATED_AT);

    board.applyRealtime(
      realtimeEvent('comment_deleted', { id: 'cm1', task_id: 't1', comment_count: 0 }, 'p1')
    );

    expect(board.taskComments.t1).toEqual([]);
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the cached count intact when a task_updated payload omits comment_count', () => {
    board.tasks = board.tasks.map((t) => (t.id === 't1' ? { ...t, comment_count: 4 } : t));
    board.applyRealtime(
      realtimeEvent('task_updated', legacyTask(task('t1', 'c1', 1000, 'A renamed')), 'p1')
    );

    expect(board.tasks.find((t) => t.id === 't1')?.title).toBe('A renamed');
    expect(board.tasks.find((t) => t.id === 't1')?.comment_count).toBe(4);
  });

  it('defaults comment_count to zero when a task_created payload omits it', () => {
    board.applyRealtime(
      realtimeEvent('task_created', legacyTask(task('t9', 'c1', 9000, 'New')), 'p1')
    );

    expect(board.tasks.find((t) => t.id === 't9')?.comment_count).toBe(0);
  });

  it('reset clears the cached comment streams', () => {
    board.taskComments = { t1: [serverComment('x')] };

    board.reset();

    expect(board.taskComments).toEqual({});
  });
});

describe('board store checklists', () => {
  function counts(taskId = 't1'): [number, number] {
    const found = board.tasks.find((t) => t.id === taskId)!;
    return [found.checklist_item_count, found.checklist_done_count];
  }

  beforeEach(async () => {
    await board.load('p1');
    board.taskChecklists = { t1: [] };
    fetchMock.mockClear();
  });

  it('addChecklistItem appends optimistically and bumps the total before the response resolves', async () => {
    const pending = board.addChecklistItem('t1', 'write the test');

    expect(board.taskChecklists.t1!.map((i) => i.text)).toEqual(['write the test']);
    expect(counts()).toEqual([1, 0]);

    await pending;

    expect(board.taskChecklists.t1!.map((i) => i.created_at)).toEqual([SERVER_CREATED_AT]);
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/checklist-items');
    expect((await request.json()).sort_key).toEqual(expect.any(String));
  });

  it('addChecklistItem re-inserts the server row when a detail fetch replaces the list mid-flight', async () => {
    const pending = board.addChecklistItem('t1', 'mine');
    // 'U…' ranks below anything the generator hands out from an empty list,
    // which is what the optimistic row was ranked against.
    board.taskChecklists = { t1: [serverChecklistItem('landed first', 'ci0', 500, false, 'U0')] };

    await pending;

    expect(board.taskChecklists.t1!.map((i) => i.text)).toEqual(['landed first', 'mine']);
  });

  it('addChecklistItem leaves an uncached list uncached and loads it once posted', async () => {
    board.taskChecklists = {};

    await board.addChecklistItem('t1', 'mine');

    expect(board.taskChecklists.t1).toEqual([serverChecklistItem()]);
    expect(counts()).toEqual([1, 0]);
  });

  it('addChecklistItem failure toasts and re-fetches the detail payload', async () => {
    mockRoutes((request, url) =>
      request.method === 'POST' && url.pathname === '/api/checklist-items'
        ? jsonResponse(404, { error: 'Task not found' })
        : undefined
    );

    await board.addChecklistItem('t1', 'doomed');

    expect(toasts.toasts.map((t) => t.message)).toContain('Task not found');
    expect(board.taskChecklists.t1).toEqual([serverChecklistItem()]);
  });

  it('setChecklistItemChecked moves the done count once, and a repeat tick does not double it', async () => {
    board.taskChecklists = { t1: [serverChecklistItem('tick me', 'ci1')] };
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, checklist_item_count: 1, checklist_done_count: 0 } : t
    );

    await board.setChecklistItemChecked('t1', 'ci1', true);
    expect(counts()).toEqual([1, 1]);
    expect(board.taskChecklists.t1![0]!.checked).toBe(true);

    await board.setChecklistItemChecked('t1', 'ci1', true);
    expect(counts()).toEqual([1, 1]);
  });

  it('renameChecklistItem patches only the text and adopts the server row', async () => {
    board.taskChecklists = { t1: [serverChecklistItem('before', 'ci1')] };

    await board.renameChecklistItem('t1', 'ci1', 'after');

    expect(board.taskChecklists.t1![0]!.text).toBe('after');
    expect(board.taskChecklists.t1![0]!.updated_at).toBe(SERVER_UPDATED_AT);
    expect(await requestAt(0).json()).toEqual({ text: 'after' });
  });

  it('moveChecklistItem reorders locally and, alone among the writes, refetches no activity log', async () => {
    vi.useFakeTimers();
    try {
      board.taskChecklists = {
        t1: [serverChecklistItem('a', 'ci1', 1000), serverChecklistItem('b', 'ci2', 2000)],
      };
      await taskActivity.load('t1');
      vi.advanceTimersByTime(1000);
      fetchMock.mockClear();

      await board.moveChecklistItem('t1', 'ci1', { sort_key: 'V3' });
      await vi.runAllTimersAsync();

      expect(board.taskChecklists.t1!.map((i) => i.text)).toEqual(['b', 'a']);
      expect(
        fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname)
      ).toEqual(['/api/checklist-items/ci1']);

      await board.setChecklistItemChecked('t1', 'ci1', true);
      await vi.runAllTimersAsync();

      expect(
        fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname)
      ).toContain('/api/tasks/t1/activity');
    } finally {
      vi.useRealTimers();
    }
  });

  it('deleteChecklistItem drops the row and both counts, never below zero', async () => {
    board.taskChecklists = { t1: [serverChecklistItem('bye', 'ci1', 1000, true)] };
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, checklist_item_count: 1, checklist_done_count: 1 } : t
    );

    await board.deleteChecklistItem('t1', 'ci1');

    expect(board.taskChecklists.t1).toEqual([]);
    expect(counts()).toEqual([0, 0]);

    await board.deleteChecklistItem('t1', 'gone');
    expect(counts()).toEqual([0, 0]);
  });

  it('promoteChecklistItem removes the item, drops the counts and inserts the card exactly once', async () => {
    board.taskChecklists = { t1: [serverChecklistItem('becomes a card', 'ci1', 1000, true)] };
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, checklist_item_count: 1, checklist_done_count: 1 } : t
    );

    const id = await board.promoteChecklistItem('t1', 'ci1');

    expect(id).not.toBeNull();
    expect(board.tasks.filter((t) => t.id === id)).toHaveLength(1);
    expect(board.taskChecklists.t1).toEqual([]);
    expect(counts()).toEqual([0, 0]);

    // The server's own echo lands afterwards and must not double the card.
    board.applyRealtime(realtimeEvent('task_created', task(id!, 'c1', 1500, 'promoted'), 'p1'));
    expect(board.tasks.filter((t) => t.id === id)).toHaveLength(1);
  });

  it('promoteChecklistItem returns null and calls nothing when the parent is gone', async () => {
    expect(await board.promoteChecklistItem('missing', 'ci1')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('applyRealtime adopts the event counts, skips a duplicate id and never seeds an uncached list', () => {
    board.applyRealtime(
      realtimeEvent(
        'checklist_item_created',
        {
          ...serverChecklistItem('theirs', 'ci9'),
          ...{ checklist_item_count: 4, checklist_done_count: 2 },
        },
        'p1'
      )
    );
    expect(counts()).toEqual([4, 2]);
    expect(board.taskChecklists.t1!.map((i) => i.id)).toEqual(['ci9']);

    board.applyRealtime(
      realtimeEvent(
        'checklist_item_created',
        {
          ...serverChecklistItem('theirs', 'ci9'),
          ...{ checklist_item_count: 4, checklist_done_count: 2 },
        },
        'p1'
      )
    );
    expect(board.taskChecklists.t1).toHaveLength(1);

    board.taskChecklists = {};
    board.applyRealtime(
      realtimeEvent(
        'checklist_item_created',
        {
          ...serverChecklistItem('theirs', 'ci9'),
          ...{ checklist_item_count: 4, checklist_done_count: 2 },
        },
        'p1'
      )
    );
    expect(board.taskChecklists.t1).toBeUndefined();
  });

  it('applyRealtime updates a row in place and re-sorts, and deletes by id', () => {
    board.taskChecklists = {
      t1: [serverChecklistItem('a', 'ci1', 1000), serverChecklistItem('b', 'ci2', 2000)],
    };

    board.applyRealtime(
      realtimeEvent(
        'checklist_item_updated',
        {
          ...serverChecklistItem('a', 'ci1', 3000, true),
          checklist_item_count: 2,
          checklist_done_count: 1,
        },
        'p1'
      )
    );
    expect(board.taskChecklists.t1!.map((i) => i.id)).toEqual(['ci2', 'ci1']);
    expect(counts()).toEqual([2, 1]);

    board.applyRealtime(
      realtimeEvent(
        'checklist_item_deleted',
        { id: 'ci1', task_id: 't1', checklist_item_count: 1, checklist_done_count: 0 },
        'p1'
      )
    );
    expect(board.taskChecklists.t1!.map((i) => i.id)).toEqual(['ci2']);
    expect(counts()).toEqual([1, 0]);
  });

  it('produces no NaN when a task arrives from a pod that predates the counts', async () => {
    const legacy = legacyTask(task('t1', 'c1', 1000, 'A'));
    delete legacy.checklist_item_count;
    delete legacy.checklist_done_count;
    board.applyRealtime(realtimeEvent('task_created', legacy, 'p1'));

    await board.addChecklistItem('t1', 'first');

    expect(counts().every(Number.isFinite)).toBe(true);
  });

  it('duplicateTask carries the source counts through the optimistic copy, since the server copies the items', async () => {
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, checklist_item_count: 3, checklist_done_count: 1 } : t
    );
    const before = new Set(board.tasks.map((t) => t.id));

    const pending = board.duplicateTask('t1');
    const copy = board.tasks.find((t) => !before.has(t.id))!;

    expect([copy.checklist_item_count, copy.checklist_done_count]).toEqual([3, 1]);
    await pending;
  });

  it('loadTaskDetail fills the checklist and heals both counts', async () => {
    board.taskChecklists = {};
    board.tasks = board.tasks.map((t) =>
      t.id === 't1' ? { ...t, checklist_item_count: 9, checklist_done_count: 9 } : t
    );

    await board.loadTaskDetail('t1');

    expect(board.taskChecklists.t1).toEqual([serverChecklistItem()]);
    expect(counts()).toEqual([1, 0]);
  });
});

describe('board store activity refresh', () => {
  // The store only refetches for the task it holds, and only once per refresh
  // window, so every test here opens t1 and steps past that window first.
  async function openLog(): Promise<void> {
    vi.useFakeTimers();
    await board.load('p1');
    await taskActivity.load('t1');
    vi.advanceTimersByTime(1000);
    fetchMock.mockClear();
  }

  function requestLines(): string[] {
    return fetchMock.mock.calls.map((call) => {
      const request = call[0] as Request;
      return `${request.method} ${new URL(request.url).pathname}`;
    });
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches the log after the patch that changed the task', async () => {
    await openLog();

    await board.updateTask('t1', { title: 'renamed' });

    expect(requestLines()).toEqual(['PATCH /api/tasks/t1', 'GET /api/tasks/t1/activity']);
  });

  it('refetches the log after the label write, not before it', async () => {
    await openLog();

    await board.setTaskLabels('t1', ['l1']);

    expect(requestLines()).toEqual(['PUT /api/tasks/t1/labels', 'GET /api/tasks/t1/activity']);
  });

  it('refetches after a move, an archive and a blocker change', async () => {
    await openLog();

    await board.moveTask('t1', 'c2', { sort_key: 'V3000' });
    vi.advanceTimersByTime(1000);
    await board.removeBlocker('t1', 't2');
    vi.advanceTimersByTime(1000);
    await board.archiveTask('t1');

    expect(requestLines().filter((line) => line.endsWith('/activity'))).toEqual([
      'GET /api/tasks/t1/activity',
      'GET /api/tasks/t1/activity',
      'GET /api/tasks/t1/activity',
    ]);
  });

  it('leaves the log alone when another task changes', async () => {
    await openLog();

    await board.updateTask('t2', { title: 'not the open one' });
    board.applyRealtime(
      realtimeEvent(
        'task_relations_set',
        { task_id: 't2', label_ids: [], assignee_ids: [], blocker_ids: [] },
        'p1'
      )
    );
    await vi.runAllTimersAsync();

    expect(requestLines()).toEqual(['PATCH /api/tasks/t2']);
  });

  it('refetches when a teammate’s relation change arrives over the socket', async () => {
    await openLog();

    board.applyRealtime(
      realtimeEvent(
        'task_relations_set',
        { task_id: 't1', label_ids: ['l1'], assignee_ids: [], blocker_ids: [] },
        'p1'
      )
    );
    await vi.runAllTimersAsync();

    expect(requestLines()).toEqual(['GET /api/tasks/t1/activity']);
  });

  it('refetches every task a deleted column relocated', async () => {
    await openLog();

    await board.deleteColumn('c1', 'c2');

    expect(requestLines()).toContain('GET /api/tasks/t1/activity');
  });
});

describe('placementAfterDrop', () => {
  it('drops into an empty zone with a usable key', () => {
    expect(placementAfterDrop([{ id: 'm', sort_key: 'V1' }], 'm').sort_key.length).toBeGreaterThan(
      0
    );
  });

  it('drops between two tasks, ranking strictly between them', () => {
    const items = [
      { id: 'a', sort_key: 'V2' },
      { id: 'm', sort_key: 'V9' },
      { id: 'b', sort_key: 'V3' },
    ];
    const placed = placementAfterDrop(items, 'm');
    expect(placed.sort_key > 'V2').toBe(true);
    expect(placed.sort_key < 'V3').toBe(true);
  });

  it('drops at the start before the first task', () => {
    const items = [
      { id: 'm', sort_key: 'V9' },
      { id: 'a', sort_key: 'V2' },
      { id: 'b', sort_key: 'V3' },
    ];
    expect(placementAfterDrop(items, 'm').sort_key < 'V2').toBe(true);
  });

  it('drops at the end after the last task', () => {
    const items = [
      { id: 'a', sort_key: 'V2' },
      { id: 'b', sort_key: 'V3' },
      { id: 'm', sort_key: 'V1' },
    ];
    expect(placementAfterDrop(items, 'm').sort_key > 'V3').toBe(true);
  });

  it('appends when the moved id is not in the items', () => {
    const items = [
      { id: 'a', sort_key: 'V2' },
      { id: 'b', sort_key: 'V3' },
    ];
    expect(placementAfterDrop(items, 'missing').sort_key > 'V3').toBe(true);
  });

  it('lands between the card above and the next real key in an unsorted display array', () => {
    const items = [
      { id: 'match', sort_key: 'V2' },
      { id: 'm', sort_key: 'V9' },
      { id: 'dim1', sort_key: 'V4' },
      { id: 'dim2', sort_key: 'V3' },
    ];
    const placed = placementAfterDrop(items, 'm');
    expect(placed.sort_key > 'V2').toBe(true);
    expect(placed.sort_key < 'V3').toBe(true);
  });

  it('prepends under every key when dropped at the display top of an unsorted array', () => {
    const items = [
      { id: 'm', sort_key: 'V9' },
      { id: 'match', sort_key: 'V5' },
      { id: 'dim', sort_key: 'V3' },
    ];
    expect(placementAfterDrop(items, 'm').sort_key < 'V3').toBe(true);
  });

  it('appends after the highest-ranked card even when it is not displayed last', () => {
    const items = [
      { id: 'match', sort_key: 'V5' },
      { id: 'm', sort_key: 'V9' },
      { id: 'dim1', sort_key: 'V3' },
      { id: 'dim2', sort_key: 'V4' },
    ];
    expect(placementAfterDrop(items, 'm').sort_key > 'V5').toBe(true);
  });

  // Two rows can share a key until the unique index lands. The drop still has
  // to rank strictly between the card above it and the next one along.
  it('ranks between the neighbors when two of them share a key', () => {
    const items = [
      { id: 'a', sort_key: 'V2' },
      { id: 'm', sort_key: 'V9' },
      { id: 'b', sort_key: 'V2' },
      { id: 'c', sort_key: 'V3' },
    ];
    const placed = placementAfterDrop(items, 'm');
    expect(placed.sort_key > 'V2').toBe(true);
    expect(placed.sort_key < 'V3').toBe(true);
  });
});

describe('board store canEdit', () => {
  const me = {
    id: 'u-me',
    email: 'me@example.com',
    name: 'Me',
    avatar_url: null,
    email_verified: false,
  };

  function withProject(created_by: string | null, members: BoardPayload['project']['members']) {
    board.project = {
      id: 'p1',
      name: 'Game',
      description: '',
      archived_at: null,
      created_by,
      member_ids: members.map((m) => m.user_id),
      members,
      is_public: false,
      color: null,
      created_at: '2026-01-01T00:00:00Z',
    };
  }

  it('is false with no project loaded', () => {
    session.user = me;
    expect(board.canEdit).toBe(false);
  });

  it('is true for the creator and for an editor member, false for a viewer', () => {
    session.user = me;

    withProject(me.id, []);
    expect(board.canEdit).toBe(true);

    withProject('u-owner', [{ user_id: me.id, role: 'editor' }]);
    expect(board.canEdit).toBe(true);

    withProject('u-owner', [{ user_id: me.id, role: 'viewer' }]);
    expect(board.canEdit).toBe(false);
  });

  it('is false on a public board, which names nobody', async () => {
    session.user = me;
    await board.load('p1', noFilters(), { readonly: true });

    expect(board.readonly).toBe(true);
    expect(board.canEdit).toBe(false);
  });

  it('drops to false when a project_updated demotes the current user', () => {
    session.user = me;
    board.currentProjectId = 'p1';
    withProject('u-owner', [{ user_id: me.id, role: 'editor' }]);

    board.applyRealtime(
      realtimeEvent(
        'project_updated',
        { id: 'p1', member_ids: [me.id], members: [{ user_id: me.id, role: 'viewer' }] },
        'p1'
      )
    );

    expect(board.canEdit).toBe(false);
    expect(board.project?.members).toEqual([{ user_id: me.id, role: 'viewer' }]);
  });

  // The creator is an implicit editor with no member row, so an ownership transfer
  // moves the permission entirely in created_by and touches no role.
  it('follows an ownership transfer in both directions', () => {
    session.user = me;
    board.currentProjectId = 'p1';
    withProject('u-owner', [{ user_id: me.id, role: 'editor' }]);

    board.applyRealtime(
      realtimeEvent(
        'project_updated',
        {
          id: 'p1',
          created_by: me.id,
          member_ids: ['u-owner'],
          members: [{ user_id: 'u-owner', role: 'editor' }],
        },
        'p1'
      )
    );

    expect(board.canEdit).toBe(true);

    board.applyRealtime(
      realtimeEvent(
        'project_updated',
        {
          id: 'p1',
          created_by: 'u-owner',
          member_ids: [me.id],
          members: [{ user_id: me.id, role: 'viewer' }],
        },
        'p1'
      )
    );

    expect(board.canEdit).toBe(false);
  });

  it('ignores a project_updated for another project', () => {
    session.user = me;
    board.currentProjectId = 'p1';
    withProject('u-owner', [{ user_id: me.id, role: 'editor' }]);

    board.applyRealtime(
      realtimeEvent(
        'project_updated',
        { id: 'p2', member_ids: [me.id], members: [{ user_id: me.id, role: 'viewer' }] },
        'p2'
      )
    );

    expect(board.canEdit).toBe(true);
  });

  it('resyncs from a mid-session 403 and stops offering edits', async () => {
    session.user = me;
    await board.load('p1');
    board.project = { ...board.project!, created_by: me.id };
    expect(board.canEdit).toBe(true);

    mockRoutes((request, url) => {
      if (request.method === 'PATCH' && url.pathname.startsWith('/api/tasks/')) {
        return jsonResponse(403, { error: 'Read-only access to this project' });
      }
      if (request.method === 'GET' && url.pathname === '/api/projects/p1') {
        return jsonResponse(200, {
          ...payload(),
          project: {
            ...payload().project,
            created_by: 'u-owner',
            member_ids: [me.id],
            members: [{ user_id: me.id, role: 'viewer' }],
          },
        });
      }
      return undefined;
    });

    await board.moveTask('t1', 'c2', { sort_key: 'V1000' });

    expect(toasts.toasts.map((t) => t.message)).toContain('Read-only access to this project');
    expect(board.canEdit).toBe(false);
    // Resynced rather than rolled back: the card is where the server says it is.
    expect(board.tasks.find((t) => t.id === 't1')?.column_id).toBe('c1');
  });
});

describe('what changed since you last looked', () => {
  describe('marking cards a teammate changed while the reader watched', () => {
    it('adds to the live set in place, so the template stays subscribed to it', () => {
      const set = board.changedTaskIds;

      board.markRemotelyChanged(['t1', 't2']);

      expect(board.changedTaskIds).toBe(set);
      expect([...board.changedTaskIds].sort()).toEqual(['t1', 't2']);
    });

    it('marks nothing on a board the reader may not edit', () => {
      board.readonly = true;

      board.markRemotelyChanged(['t1']);

      expect(board.changedTaskIds.size).toBe(0);
    });

    // Deliberately unlike the entry capture, which #lookedAtTaskIds filters:
    // having read a card is no reason to hide that it has changed since.
    it('re-marks a card the reader had already opened this visit', () => {
      board.clearChanged('t1');

      board.markRemotelyChanged(['t1']);

      expect(board.changedTaskIds.has('t1')).toBe(true);
    });
  });

  function stampedPaths(): string[] {
    return fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .filter((request) => request.method === 'PUT')
      .map((request) => new URL(request.url).pathname);
  }

  function boardServing(changedTaskIds: string[] | undefined): void {
    mockRoutes((request, url) => {
      if (request.method !== 'GET' || url.pathname !== '/api/projects/p1') {
        return undefined;
      }
      const body: Record<string, unknown> = { ...payload() };
      if (changedTaskIds === undefined) {
        delete body.changed_task_ids;
      } else {
        body.changed_task_ids = changedTaskIds;
      }
      return jsonResponse(200, body);
    });
  }

  it('captures the changed cards once on entry and keeps them across later reads', async () => {
    boardServing(['t1', 't3']);

    board.armSeen();
    await board.load('p1');

    expect([...board.changedTaskIds].sort()).toEqual(['t1', 't3']);
    expect(stampedPaths()).toEqual(['/api/projects/p1/seen']);

    // What opening a card overlay does: the same board, revalidated — and by now
    // the stamp has made the server's honest answer empty.
    boardServing([]);
    await board.refetch();

    expect([...board.changedTaskIds].sort()).toEqual(['t1', 't3']);
    expect(stampedPaths()).toEqual(['/api/projects/p1/seen']);
  });

  it('captures again on the next entry', async () => {
    boardServing(['t1']);
    board.armSeen();
    await board.load('p1');

    board.reset();
    boardServing(['t2']);
    board.armSeen();
    await board.load('p1');

    expect([...board.changedTaskIds]).toEqual(['t2']);
    expect(stampedPaths()).toEqual(['/api/projects/p1/seen', '/api/projects/p1/seen']);
  });

  it('drops a card from the capture once its details have been opened', async () => {
    boardServing(['t1', 't3']);

    board.armSeen();
    await board.load('p1');
    board.clearChanged('t1');

    expect([...board.changedTaskIds]).toEqual(['t3']);
    // Reading a card is not a second stamp: the board's marker moved on entry.
    expect(stampedPaths()).toEqual(['/api/projects/p1/seen']);
  });

  it('keeps a card out of a capture that lands after its details opened', async () => {
    boardServing(['t1', 't3']);

    board.armSeen();
    const loaded = board.load('p1');
    board.clearChanged('t1');
    await loaded;

    expect([...board.changedTaskIds]).toEqual(['t3']);
  });

  it('tints a card read on the last visit that has changed again since', async () => {
    boardServing(['t1']);
    board.armSeen();
    await board.load('p1');
    board.clearChanged('t1');

    board.reset();
    boardServing(['t1']);
    board.armSeen();
    await board.load('p1');

    expect([...board.changedTaskIds]).toEqual(['t1']);
  });

  it('tints it again on a re-entry that is served from the cache', async () => {
    boardServing(['t1']);
    board.armSeen();
    await board.load('p1');
    board.clearChanged('t1');

    // Stepping out to My Tasks and back: the same board, so it is served from the
    // cache and revalidated behind the scenes rather than reset and refetched.
    boardServing(['t1']);
    board.armSeen();
    await board.load('p1');

    await vi.waitFor(() => expect([...board.changedTaskIds]).toEqual(['t1']));
  });

  it('shows no highlights and raises nothing when the API does not name the changed cards', async () => {
    boardServing(undefined);

    board.armSeen();
    await board.load('p1');

    expect(board.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    expect([...board.changedTaskIds]).toEqual([]);
    expect(board.error).toBeNull();
    expect(toasts.toasts).toEqual([]);
  });

  it('captures nothing and stamps nothing on an anonymous public board', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      return url.pathname === '/api/public/projects/p1/board'
        ? jsonResponse(200, {
            project: { id: 'p1', name: 'Public Game', description: '' },
            columns: [
              { id: 'c1', name: 'Todo', position: 1000, sort_key: 'V0000010001', is_done: false },
            ],
            tasks: [
              {
                id: 't1',
                column_id: 'c1',
                title: 'A',
                description: null,
                sort_key: 'V0000010001',
                label_ids: [],
                assignee_ids: [],
                blocker_ids: [],
                open_cross_project_blocker_count: 0,
                image_count: 0,
                cover_image_url: null,
                comment_count: 0,
              },
            ],
            labels: [],
            users: [],
            comments: [],
            changed_task_ids: ['t1'],
          })
        : jsonResponse(404, { error: 'This board is not public' });
    });

    board.armSeen();
    await board.load('p1', undefined, { readonly: true });

    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
    expect([...board.changedTaskIds]).toEqual([]);
    expect(stampedPaths()).toEqual([]);
  });
});

describe('board store attachments', () => {
  const A1 = testUuid('att1');
  const A2 = testUuid('att2');

  function serverAttachment(overrides: Partial<TaskAttachment> = {}): TaskAttachment {
    return {
      id: A1,
      task_id: 't1',
      kind: 'file',
      image_url: null,
      is_cover: false,
      title: null,
      description: null,
      filename: 'spec.pdf',
      content_type: 'application/pdf',
      size_bytes: 12,
      url: null,
      preview_url: null,
      favicon_url: null,
      unfurl_state: null,
      created_at: SERVER_CREATED_AT,
      updated_at: SERVER_CREATED_AT,
      ...overrides,
    };
  }

  function withAttachments(attachments: TaskAttachment[]): void {
    mockRoutes((request, url) => {
      if (request.method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
        return jsonResponse(200, {
          ...task('t1', 'c1', 1000, 'A'),
          project_id: 'p1',
          images: [],
          comments: [],
          checklist_items: [],
          attachments,
        });
      }
      if (url.pathname.startsWith('/api/attachments')) {
        return jsonResponse(201, serverAttachment({ id: A2, filename: 'server.pdf' }));
      }
      return undefined;
    });
  }

  beforeEach(async () => {
    await board.load('p1');
    board.taskAttachments = { t1: [] };
    fetchMock.mockClear();
  });

  it('loadTaskDetail fills the list from the detail payload', async () => {
    withAttachments([serverAttachment()]);
    board.taskAttachments = {};

    await board.loadTaskDetail('t1');

    expect(board.taskAttachments.t1).toEqual([serverAttachment()]);
  });

  it('loadTaskDetail leaves the list empty for a pod that predates attachments', async () => {
    board.taskAttachments = {};

    await board.loadTaskDetail('t1');

    expect(board.taskAttachments.t1).toEqual([]);
  });

  it('addLinkAttachment appends a pending row before the response and swaps it for the server row', async () => {
    withAttachments([]);
    const pending = board.addLinkAttachment('t1', 'https://example.com/doc');

    expect(board.taskAttachments.t1!.map((a) => [a.kind, a.url, a.unfurl_state])).toEqual([
      ['link', 'https://example.com/doc', 'pending'],
    ]);

    await pending;

    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual([A2]);
    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/attachments/links');
    expect((await request.json()).url).toBe('https://example.com/doc');
  });

  it('uploadTaskAttachment sends the file as the body and appends the created row', async () => {
    withAttachments([]);

    const created = await board.uploadTaskAttachment(
      't1',
      new File(['x'], 'notes.txt', { type: 'text/plain' })
    );

    expect(created?.id).toBe(A2);
    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual([A2]);

    const url = new URL(requestAt(0).url);
    expect(url.pathname).toBe('/api/attachments/files');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      task_id: 't1',
      filename: 'notes.txt',
      content_type: 'text/plain',
    });
    // A body the browser can stream, rather than a form it has to assemble first.
    // jsdom's Request drops a Blob body, so what it carries cannot be asserted here.
    expect(requestAt(0).headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('uploadTaskAttachment adds nothing twice when the realtime echo beat the response', async () => {
    withAttachments([]);

    const upload = board.uploadTaskAttachment(
      't1',
      new File(['x'], 'notes.txt', { type: 'text/plain' })
    );
    board.applyRealtime(
      realtimeEvent(
        'attachment_created',
        { ...serverAttachment({ id: A2 }), attachment_count: 1 },
        'p1'
      )
    );
    await upload;

    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual([A2]);
    expect(board.tasks.find((t) => t.id === 't1')!.attachment_count).toBe(1);
  });

  it('uploadTaskAttachment names an unnamed, untyped file rather than sending nothing', async () => {
    withAttachments([]);

    await board.uploadTaskAttachment('t1', new File(['x'], ''));

    expect(Object.fromEntries(new URL(requestAt(0).url).searchParams)).toEqual({
      task_id: 't1',
      filename: 'attachment',
      content_type: 'application/octet-stream',
    });
  });

  it('uploadTaskAttachment surfaces the server message and adds nothing', async () => {
    mockRoutes((_request, url) =>
      url.pathname === '/api/attachments/files'
        ? jsonResponse(413, { error: 'Payload too large' })
        : undefined
    );

    const created = await board.uploadTaskAttachment('t1', new File(['x'], 'big.zip'));

    expect(created).toBeNull();
    expect(board.taskAttachments.t1).toEqual([]);
    expect(toasts.toasts.map((t) => t.message)).toEqual(['Payload too large']);
  });

  it('patchAttachment writes the title optimistically and adopts the server row', async () => {
    withAttachments([]);
    board.taskAttachments = { t1: [serverAttachment()] };

    const pending = board.patchAttachment('t1', A1, { title: 'The spec' });
    expect(board.taskAttachments.t1![0].title).toBe('The spec');

    await pending;

    expect(board.taskAttachments.t1![0].id).toBe(A2);
    expect(new URL(requestAt(0).url).pathname).toBe(`/api/attachments/${A1}`);
  });

  it('deleteAttachment removes the row before the response resolves', async () => {
    board.taskAttachments = { t1: [serverAttachment()] };

    const pending = board.deleteAttachment('t1', A1);
    expect(board.taskAttachments.t1).toEqual([]);

    await pending;
    expect(new URL(requestAt(0).url).pathname).toBe(`/api/attachments/${A1}`);
  });

  it('refetches the detail payload rather than rolling back when a mutation fails', async () => {
    mockRoutes((request, url) => {
      if (request.method === 'DELETE' && url.pathname.startsWith('/api/attachments/')) {
        return jsonResponse(500, { error: 'Server error' });
      }
      if (request.method === 'GET' && /^\/api\/tasks\/[^/]+$/.test(url.pathname)) {
        return jsonResponse(200, {
          ...task('t1', 'c1', 1000, 'A'),
          project_id: 'p1',
          images: [],
          comments: [],
          checklist_items: [],
          attachments: [serverAttachment()],
        });
      }
      return undefined;
    });
    board.taskAttachments = { t1: [serverAttachment()] };

    await board.deleteAttachment('t1', A1);

    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual([A1]);
    expect(toasts.toasts).toHaveLength(1);
  });

  it('applyRealtime appends a created row once, skipping the adder’s own echo', () => {
    board.taskAttachments = { t1: [] };

    board.applyRealtime(realtimeEvent('attachment_created', serverAttachment(), 'p1'));
    board.applyRealtime(realtimeEvent('attachment_created', serverAttachment(), 'p1'));

    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual([A1]);
  });

  it('applyRealtime does nothing when the list is not cached', () => {
    board.taskAttachments = {};

    board.applyRealtime(realtimeEvent('attachment_created', serverAttachment(), 'p1'));

    expect(board.taskAttachments.t1).toBeUndefined();
  });

  it('applyRealtime swaps in an unfurled row and deletes by the id the event carries', () => {
    board.taskAttachments = {
      t1: [serverAttachment({ kind: 'link', url: 'https://x.test/', unfurl_state: 'pending' })],
    };

    board.applyRealtime(
      realtimeEvent(
        'attachment_updated',
        serverAttachment({
          kind: 'link',
          url: 'https://x.test/',
          unfurl_state: 'ok',
          title: 'Fetched',
          preview_url: `/api/attachments/${A1}/preview`,
        }),
        'p1'
      )
    );
    expect(board.taskAttachments.t1![0]).toMatchObject({
      title: 'Fetched',
      unfurl_state: 'ok',
      preview_url: `/api/attachments/${A1}/preview`,
    });

    board.applyRealtime(
      realtimeEvent('attachment_deleted', { id: A1, task_id: 't1', attachment_count: 0 }, 'p1')
    );
    expect(board.taskAttachments.t1).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('card-face count', () => {
    const countOf = (): number | undefined =>
      board.tasks.find((t) => t.id === 't1')?.attachment_count;

    it('rises with an upload and a link, and falls with a delete, before the response', async () => {
      withAttachments([]);
      expect(countOf()).toBe(0);

      await board.uploadTaskAttachment('t1', new File(['x'], 'notes.txt'));
      expect(countOf()).toBe(1);

      const pendingLink = board.addLinkAttachment('t1', 'https://example.com/');
      expect(countOf()).toBe(2);
      await pendingLink;

      const pendingDelete = board.deleteAttachment('t1', A2);
      expect(countOf()).toBe(1);
      await pendingDelete;
    });

    it('never falls below zero when a delete arrives for a card already at zero', async () => {
      withAttachments([]);
      await board.deleteAttachment('t1', A1);
      expect(countOf()).toBe(0);
    });

    it('adopts the count the realtime events carry', () => {
      board.taskAttachments = { t1: [] };

      board.applyRealtime(
        realtimeEvent('attachment_created', { ...serverAttachment(), attachment_count: 4 }, 'p1')
      );
      expect(countOf()).toBe(4);

      board.applyRealtime(
        realtimeEvent('attachment_deleted', { id: A1, task_id: 't1', attachment_count: 3 }, 'p1')
      );
      expect(countOf()).toBe(3);
    });

    // The count is the only thing on the card face that a missed event can strand,
    // so opening the card has to be able to heal it.
    it('is healed from the detail payload, which carries the list rather than a count', async () => {
      withAttachments([serverAttachment(), serverAttachment({ id: A2 })]);
      board.tasks = board.tasks.map((t) => (t.id === 't1' ? { ...t, attachment_count: 9 } : t));

      await board.loadTaskDetail('t1');

      expect(countOf()).toBe(2);
    });
  });

  it('reset clears the cached lists', async () => {
    board.taskAttachments = { t1: [serverAttachment()] };

    board.reset();

    expect(board.taskAttachments).toEqual({});
  });
});

describe('a board read that cannot reach the server', () => {
  const ADA = { id: testUuid('ada'), name: 'Ada', email: 'ada@example.com', avatar_url: null };

  beforeEach(async () => {
    session.user = ADA as never;
    await clearOfflineCache(ADA.id);
  });

  afterEach(async () => {
    await clearOfflineCache(ADA.id);
    session.user = null;
  });

  async function loadOnce(): Promise<void> {
    fetchMock.mockResolvedValue(jsonResponse(200, payload()));
    await board.load('p1', noFilters());
    await board.persistSnapshot();
    fetchMock.mockReset();
  }

  // The alternative — an error page over data this device is holding — is the
  // blank-window failure the whole feature exists to avoid.
  it('shows the last version this device saw rather than an error', async () => {
    await loadOnce();
    board.reset();

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await board.load('p1', noFilters());

    expect(board.error).toBeNull();
    expect(board.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
    // And can say how old it is rather than implying it is current.
    expect(board.syncedAt).not.toBeNull();
  });

  // A server that answered and refused is a real error, and hiding it behind a
  // stale board would be the dishonest kind of graceful.
  it('still reports a refusal as the error it is', async () => {
    await loadOnce();
    board.reset();

    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Not a member' }));
    await board.load('p1', noFilters());

    expect(board.error).toBe('Not a member');
    expect(board.errorStatus).toBe(403);
  });

  it('has nothing to fall back on for a project this device never loaded', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await board.load('p-never-seen', noFilters());

    expect(board.error).toBe('Failed to load board');
  });
});
