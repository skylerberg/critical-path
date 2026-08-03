import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { board } from './board.svelte';
import { invitations } from './invitations.svelte';
import type { BoardPayload } from './board-types';
import { projects, type Project } from './projects.svelte';
import { realtime } from './realtime.svelte';
import { session } from './session.svelte';
import { taskSeries } from './taskSeries.svelte';
import { users } from './users.svelte';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.({ code });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  messages(): { type: string; [key: string]: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket);

function task(id: string, columnId = 'c1', position = 1000) {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    position,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [] as string[],
    assignee_ids: [] as string[],
    blocker_ids: [] as string[],
    image_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function image(id: string) {
  return {
    id,
    url: `/api/images/${id}`,
    filename: `${id}.png`,
    content_type: 'image/png',
    size_bytes: 10,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function comment(id: string, text: string) {
  return {
    id,
    task_id: 't1',
    user_id: 'u1',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    comment_count: 1,
  };
}

function boardPayload(): BoardPayload {
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
    columns: [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }],
    tasks: [],
    labels: [],
    changed_task_ids: [],
  };
}

function project(overrides: Partial<Project> = {}): Project {
  const memberIds = overrides.member_ids ?? [];
  return {
    id: 'p1',
    name: 'Game',
    description: '',
    archived_at: null,
    created_by: null,
    member_ids: memberIds,
    members: memberIds.map((user_id) => ({ user_id, role: 'editor' as const })),
    is_public: false,
    color: null,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    position: null,
    last_seen_at: null,
    has_unseen_changes: false,
    ...overrides,
  };
}

function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) {
    throw new Error('no socket created');
  }
  return socket;
}

async function connectAndAuth(projectId: string | null): Promise<FakeWebSocket> {
  board.currentProjectId = projectId;
  realtime.connect();
  const socket = latestSocket();
  socket.open();
  socket.receive({ type: 'auth_ok' });
  return socket;
}

beforeEach(async () => {
  vi.useRealTimers();
  fetchMock.mockReset();
  FakeWebSocket.instances = [];
  realtime.disconnect();
  board.reset();
  projects.reset();
  taskSeries.reset();
  localStorage.setItem('cp.token', 'test-token');
  fetchMock.mockResolvedValue(
    jsonResponse(200, {
      id: 'u1',
      name: 'Me',
      email: 'm@e.com',
      avatar_url: null,
      email_verified: false,
    })
  );
  await session.init();
  fetchMock.mockReset();
});

afterEach(() => {
  realtime.disconnect();
  vi.useRealTimers();
});

describe('realtime handshake', () => {
  it('sends auth on open then subscribes to the current project on auth_ok', async () => {
    const socket = await connectAndAuth('p1');
    expect(socket.messages()).toContainEqual({ type: 'auth', token: 'test-token' });
    expect(socket.messages()).toContainEqual({ type: 'subscribe', project_id: 'p1' });
    expect(realtime.status).toBe('online');
  });

  it('does not subscribe before auth_ok', () => {
    board.currentProjectId = 'p1';
    realtime.connect();
    const socket = latestSocket();
    socket.open();
    expect(socket.messages().some((m) => m.type === 'subscribe')).toBe(false);
  });

  it('replies to ping with pong', async () => {
    const socket = await connectAndAuth('p1');
    socket.receive({ type: 'ping' });
    expect(socket.messages()).toContainEqual({ type: 'pong' });
  });

  it('resubscribes when the open project changes', async () => {
    const socket = await connectAndAuth('p1');
    board.currentProjectId = 'p2';
    flushSync();
    expect(socket.messages()).toContainEqual({ type: 'unsubscribe', project_id: 'p1' });
    expect(socket.messages()).toContainEqual({ type: 'subscribe', project_id: 'p2' });
  });

  it('never subscribes to a read-only board, and resubscribes on the way back', async () => {
    board.readonly = true;
    const socket = await connectAndAuth('p1');
    expect(socket.messages().some((m) => m.type === 'subscribe')).toBe(false);

    board.readonly = false;
    flushSync();
    expect(socket.messages()).toContainEqual({ type: 'subscribe', project_id: 'p1' });
  });
});

describe('board event application', () => {
  beforeEach(() => {
    board.currentProjectId = 'p1';
  });

  it('upserts and is idempotent for task_created/updated', () => {
    const event = { type: 'task_created', project_id: 'p1', data: task('t1') };
    board.applyRealtime(event);
    board.applyRealtime(event);
    expect(board.tasks).toHaveLength(1);
    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: { ...task('t1'), title: 'Renamed' },
    });
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.title).toBe('Renamed');
  });

  it('adopts a due date set by a teammate, and its removal', () => {
    board.tasks = [task('t1')];

    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: { ...task('t1'), due_date: '2026-08-03' },
    });
    expect(board.tasks[0]!.due_date).toBe('2026-08-03');

    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: { ...task('t1'), due_date: null },
    });
    expect(board.tasks[0]!.due_date).toBeNull();
  });

  it('removes on task_deleted and strips it from other blocker_ids', () => {
    board.tasks = [task('t1'), { ...task('t2'), blocker_ids: ['t1'] }];
    board.applyRealtime({ type: 'task_deleted', project_id: 'p1', data: { id: 't1' } });
    board.applyRealtime({ type: 'task_deleted', project_id: 'p1', data: { id: 't1' } });
    expect(board.tasks.map((t) => t.id)).toEqual(['t2']);
    expect(board.tasks[0]!.blocker_ids).toEqual([]);
  });

  it('overwrites the three arrays on task_relations_set', () => {
    board.tasks = [task('t1')];
    board.applyRealtime({
      type: 'task_relations_set',
      project_id: 'p1',
      data: { task_id: 't1', label_ids: ['l1'], assignee_ids: ['u2'], blocker_ids: ['t9'] },
    });
    expect(board.tasks[0]).toMatchObject({
      label_ids: ['l1'],
      assignee_ids: ['u2'],
      blocker_ids: ['t9'],
    });
  });

  it('upserts columns sorted by position', () => {
    board.applyRealtime({
      type: 'column_created',
      project_id: 'p1',
      data: { id: 'c2', name: 'Done', position: 500, is_done: true },
    });
    board.applyRealtime({
      type: 'column_created',
      project_id: 'p1',
      data: { id: 'c1', name: 'Todo', position: 1000, is_done: false },
    });
    expect(board.columns.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('removes the column and applies moved_tasks on column_deleted', () => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Done', position: 2000, is_done: true },
    ];
    board.tasks = [task('t1', 'c1'), task('t2', 'c1')];
    board.applyRealtime({
      type: 'column_deleted',
      project_id: 'p1',
      data: { id: 'c1', moved_tasks: [{ id: 't1', column_id: 'c2', position: 3000 }] },
    });
    expect(board.columns.map((c) => c.id)).toEqual(['c2']);
    expect(board.tasks.find((t) => t.id === 't1')).toMatchObject({
      column_id: 'c2',
      position: 3000,
    });
    expect(board.tasks.find((t) => t.id === 't2')).toBeUndefined();
  });

  it('applies label create/update/delete and strips deleted labels from tasks', () => {
    board.tasks = [{ ...task('t1'), label_ids: ['l1'] }];
    board.filterLabelIds = ['l1'];
    board.applyRealtime({
      type: 'label_created',
      project_id: 'p1',
      data: { id: 'l1', name: 'art', color: '#f00' },
    });
    expect(board.labels).toHaveLength(1);
    board.applyRealtime({ type: 'label_deleted', project_id: 'p1', data: { id: 'l1' } });
    expect(board.labels).toHaveLength(0);
    expect(board.tasks[0]!.label_ids).toEqual([]);
    expect(board.filterLabelIds).toEqual([]);
  });

  it('sets image_count from image_created/deleted events', () => {
    board.tasks = [task('t1')];
    board.applyRealtime({
      type: 'image_created',
      project_id: 'p1',
      data: { task_id: 't1', image_count: 3 },
    });
    expect(board.tasks[0]!.image_count).toBe(3);
    board.applyRealtime({
      type: 'image_deleted',
      project_id: 'p1',
      data: { task_id: 't1', image_count: 2 },
    });
    expect(board.tasks[0]!.image_count).toBe(2);
  });

  it('appends the image row to an open grid on image_created and dedups the echo', () => {
    board.tasks = [task('t1')];
    board.taskImages = { t1: [image('img1')] };
    const created = { ...image('img2'), task_id: 't1', image_count: 2 };

    board.applyRealtime({ type: 'image_created', project_id: 'p1', data: created });
    expect(board.taskImages['t1']!.map((i) => i.id)).toEqual(['img1', 'img2']);
    expect(board.tasks[0]!.image_count).toBe(2);

    board.applyRealtime({ type: 'image_created', project_id: 'p1', data: created });
    expect(board.taskImages['t1']!.map((i) => i.id)).toEqual(['img1', 'img2']);
  });

  it('leaves an uncached grid untouched on image_created', () => {
    board.tasks = [task('t1')];
    board.applyRealtime({
      type: 'image_created',
      project_id: 'p1',
      data: { ...image('imgX'), task_id: 't1', image_count: 1 },
    });
    expect(board.taskImages['t1']).toBeUndefined();
    expect(board.tasks[0]!.image_count).toBe(1);
  });

  it('refetches an open grid on image_deleted and adopts the surviving cover', async () => {
    board.tasks = [{ ...task('t1'), image_count: 2, cover_image_url: '/api/images/img2' }];
    board.taskImages = { t1: [image('img1'), image('img2')] };
    fetchMock.mockImplementation(async () => jsonResponse(200, { images: [image('img1')] }));

    board.applyRealtime({
      type: 'image_deleted',
      project_id: 'p1',
      data: { task_id: 't1', image_count: 1, cover_image_url: null },
    });
    expect(board.tasks[0]!.image_count).toBe(1);
    expect(board.tasks[0]!.cover_image_url).toBeNull();
    await vi.waitFor(() => expect(board.taskImages['t1']!.map((i) => i.id)).toEqual(['img1']));
  });

  it('keeps a cover that survives someone else deleting another image', () => {
    board.tasks = [{ ...task('t1'), image_count: 2, cover_image_url: '/api/images/img1' }];

    board.applyRealtime({
      type: 'image_deleted',
      project_id: 'p1',
      data: { task_id: 't1', image_count: 1, cover_image_url: '/api/images/img1' },
    });

    expect(board.tasks[0]!.cover_image_url).toBe('/api/images/img1');
  });

  it('reads an image_deleted that predates covers as no cover, never undefined', () => {
    board.tasks = [{ ...task('t1'), image_count: 2, cover_image_url: '/api/images/img1' }];

    board.applyRealtime({
      type: 'image_deleted',
      project_id: 'p1',
      data: { task_id: 't1', image_count: 1 },
    });

    expect(board.tasks[0]!.cover_image_url).toBeNull();
  });

  it('adopts a cover chosen by a teammate on task_updated', () => {
    board.tasks = [task('t1')];

    board.applyRealtime({
      type: 'task_updated',
      project_id: 'p1',
      data: { ...task('t1'), cover_image_url: '/api/images/img7' },
    });

    expect(board.tasks[0]!.cover_image_url).toBe('/api/images/img7');
  });

  it('ignores board events for a different project', async () => {
    const socket = await connectAndAuth('p1');
    socket.receive({ type: 'task_created', project_id: 'p-other', data: task('tx') });
    expect(board.tasks).toHaveLength(0);
  });

  it('routes the three comment events off the wire into the board store', async () => {
    board.tasks = [task('t1')];
    board.taskComments = { t1: [] };
    const socket = await connectAndAuth('p1');

    socket.receive({ type: 'comment_created', project_id: 'p1', data: comment('cm1', 'hello') });
    expect(board.taskComments['t1']!.map((c) => c.id)).toEqual(['cm1']);
    expect(board.tasks[0]!.comment_count).toBe(1);

    socket.receive({
      type: 'comment_updated',
      project_id: 'p1',
      data: { ...comment('cm1', 'edited'), comment_count: undefined },
    });
    expect(JSON.stringify(board.taskComments['t1']![0]!.body)).toContain('edited');

    socket.receive({
      type: 'comment_deleted',
      project_id: 'p1',
      data: { id: 'cm1', task_id: 't1', comment_count: 0 },
    });
    expect(board.taskComments['t1']).toEqual([]);
    expect(board.tasks[0]!.comment_count).toBe(0);
  });

  it('ignores a comment event for a different project', async () => {
    board.tasks = [task('t1')];
    board.taskComments = { t1: [] };
    const socket = await connectAndAuth('p1');

    socket.receive({
      type: 'comment_created',
      project_id: 'p-other',
      data: comment('cm1', 'elsewhere'),
    });

    expect(board.taskComments['t1']).toEqual([]);
    expect(board.tasks[0]!.comment_count).toBe(0);
  });
});

describe('project event application', () => {
  it('upserts and removes projects', () => {
    projects.applyRealtime({ type: 'project_created', project_id: 'p1', data: project() });
    projects.applyRealtime({ type: 'project_created', project_id: 'p1', data: project() });
    expect(projects.projects).toHaveLength(1);
    projects.applyRealtime({
      type: 'project_updated',
      project_id: 'p1',
      data: { id: 'p1', name: 'Renamed' },
    });
    expect(projects.projects[0]!.name).toBe('Renamed');
    projects.applyRealtime({ type: 'project_deleted', project_id: 'p1', data: { id: 'p1' } });
    expect(projects.projects).toHaveLength(0);
  });

  it('merges member_ids from a project_updated membership change', () => {
    projects.projects = [project({ member_ids: ['u2'] })];
    projects.applyRealtime({
      type: 'project_updated',
      project_id: 'p1',
      data: { id: 'p1', member_ids: ['u2', 'u3'] },
    });
    expect(projects.projects[0]!.member_ids).toEqual(['u2', 'u3']);
    expect(projects.projects[0]!.name).toBe('Game');
  });

  it('upserts an unknown project from a project_updated broadcast', () => {
    projects.applyRealtime({
      type: 'project_updated',
      project_id: 'p9',
      data: { id: 'p9', name: 'Gained', member_ids: ['u1'] },
    });
    expect(projects.projects).toHaveLength(1);
    expect(projects.projects[0]!.member_ids).toEqual(['u1']);
  });

  it('evicts the project on project_deleted when access is lost', () => {
    projects.projects = [project(), project({ id: 'p2', name: 'Other' })];
    projects.applyRealtime({ type: 'project_deleted', project_id: 'p1', data: { id: 'p1' } });
    expect(projects.projects.map((p) => p.id)).toEqual(['p2']);
  });

  it('merges the position from a project_position_updated wire event', async () => {
    projects.projects = [project()];
    const socket = await connectAndAuth(null);
    socket.receive({ type: 'project_position_updated', data: { id: 'p1', position: 250 } });
    expect(projects.projects[0]!.position).toBe(250);
  });
});

describe('series event application', () => {
  const seriesRow = { id: 's1', project_id: 'p1', title: 'Weekly review', status: 'active' };

  beforeEach(async () => {
    board.currentProjectId = 'p1';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [] }));
    await taskSeries.load('p1');
    fetchMock.mockReset();
  });

  it('routes the three series events off the wire into the series store', async () => {
    const socket = await connectAndAuth('p1');

    socket.receive({ type: 'series_created', project_id: 'p1', data: seriesRow });
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s1']);

    socket.receive({
      type: 'series_updated',
      project_id: 'p1',
      data: { ...seriesRow, title: 'Renamed' },
    });
    expect(taskSeries.list[0]!.title).toBe('Renamed');

    socket.receive({ type: 'series_deleted', project_id: 'p1', data: { id: 's1' } });
    expect(taskSeries.list).toEqual([]);
  });

  it('ignores a series event for a different project', async () => {
    const socket = await connectAndAuth('p1');

    socket.receive({
      type: 'series_created',
      project_id: 'p-other',
      data: { ...seriesRow, project_id: 'p-other' },
    });

    expect(taskSeries.list).toEqual([]);
  });

  it('applies a series event while a drag is live instead of queueing it', async () => {
    const socket = await connectAndAuth('p1');
    board.dragging = true;

    socket.receive({ type: 'series_created', project_id: 'p1', data: seriesRow });

    expect(taskSeries.list.map((row) => row.id)).toEqual(['s1']);
    board.dragging = false;
  });

  it('re-reads the series list on a reconnect but not on the first connect', async () => {
    await connectAndAuth('p1');
    expect(
      fetchMock.mock.calls.some(
        (call) => new URL((call[0] as Request).url).pathname === '/api/task-series'
      )
    ).toBe(false);

    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/task-series') {
        return jsonResponse(200, { series: [seriesRow] });
      }
      if (url.pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      return jsonResponse(200, boardPayload());
    });

    vi.useFakeTimers();
    latestSocket().serverClose();
    vi.advanceTimersByTime(1000);
    const socket2 = latestSocket();
    socket2.open();
    socket2.receive({ type: 'auth_ok' });

    // openapi-fetch invokes fetch after an awaited request-middleware microtask.
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
    }
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s1']);
  });
});

describe('drag-aware queue', () => {
  it('holds board events while dragging and flushes after finalize', async () => {
    const socket = await connectAndAuth('p1');
    board.dragging = true;
    socket.receive({ type: 'task_created', project_id: 'p1', data: task('t1') });
    expect(board.tasks).toHaveLength(0);
    board.dragging = false;
    flushSync();
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('holds a checklist event behind a card-overlay drag, which the board flag never sees', async () => {
    board.tasks = [task('t1')];
    board.taskChecklists = { t1: [] };
    const socket = await connectAndAuth('p1');
    const item = {
      id: 'ci1',
      task_id: 't1',
      text: 'theirs',
      checked: false,
      position: 1000,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      checklist_item_count: 1,
      checklist_done_count: 0,
    };

    board.detailDragging = true;
    socket.receive({ type: 'checklist_item_created', project_id: 'p1', data: item });
    expect(board.taskChecklists.t1).toEqual([]);
    expect(board.tasks[0]!.checklist_item_count).toBe(0);

    board.detailDragging = false;
    flushSync();
    expect(board.taskChecklists.t1!.map((i) => i.id)).toEqual(['ci1']);
    expect(board.tasks[0]!.checklist_item_count).toBe(1);
  });

  it('treats task_archived as a board event: project-filtered, queued, then applied', async () => {
    board.tasks = [task('t1')];
    const socket = await connectAndAuth('p1');
    const archived = { ...task('t1'), archived_at: '2026-03-01T00:00:00Z' };

    socket.receive({ type: 'task_archived', project_id: 'p2', data: archived });
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);

    board.dragging = true;
    socket.receive({ type: 'task_archived', project_id: 'p1', data: archived });
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);

    board.dragging = false;
    flushSync();
    expect(board.tasks).toHaveLength(0);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('treats column_tasks_moved as a board event: project-filtered, queued, then applied', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', position: 1000, is_done: false },
      { id: 'c2', name: 'Done', position: 2000, is_done: true },
    ];
    board.tasks = [task('t1', 'c1')];
    const socket = await connectAndAuth('p1');
    const data = {
      column_id: 'c1',
      target_column_id: 'c2',
      moved_tasks: [{ id: 't1', column_id: 'c2', position: 3000 }],
    };

    socket.receive({ type: 'column_tasks_moved', project_id: 'p2', data });
    expect(board.tasks[0]!.column_id).toBe('c1');

    board.dragging = true;
    socket.receive({ type: 'column_tasks_moved', project_id: 'p1', data });
    expect(board.tasks[0]!.column_id).toBe('c1');

    board.dragging = false;
    flushSync();
    expect(board.tasks[0]).toMatchObject({ column_id: 'c2', position: 3000 });
    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('treats column_tasks_reordered as a board event: project-filtered, queued, then applied', async () => {
    board.tasks = [task('t1', 'c1', 1000), task('t2', 'c1', 2000)];
    const socket = await connectAndAuth('p1');
    const data = {
      column_id: 'c1',
      moved_tasks: [
        { id: 't1', position: 2000 },
        { id: 't2', position: 1000 },
      ],
    };

    socket.receive({ type: 'column_tasks_reordered', project_id: 'p2', data });
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2']);

    board.dragging = true;
    socket.receive({ type: 'column_tasks_reordered', project_id: 'p1', data });
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2']);

    board.dragging = false;
    flushSync();
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('treats column_tasks_archived as a board event: project-filtered, queued, then applied', async () => {
    board.tasks = [task('t1', 'c1'), { ...task('t2', 'c2'), blocker_ids: ['t1'] }];
    const socket = await connectAndAuth('p1');
    const data = {
      column_id: 'c1',
      tasks: [{ ...task('t1', 'c1'), archived_at: '2026-03-01T00:00:00Z' }],
    };

    socket.receive({ type: 'column_tasks_archived', project_id: 'p2', data });
    expect(board.tasks.map((t) => t.id)).toEqual(['t1', 't2']);

    board.dragging = true;
    socket.receive({ type: 'column_tasks_archived', project_id: 'p1', data });
    expect(board.tasks.map((t) => t.id)).toEqual(['t1', 't2']);

    board.dragging = false;
    flushSync();
    expect(board.tasks.map((t) => t.id)).toEqual(['t2']);
    expect(board.tasks[0]!.blocker_ids).toEqual([]);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('treats task_restored as a board event: project-filtered, queued, then applied', async () => {
    board.archivedTasks = [{ ...task('t1'), archived_at: '2026-03-01T00:00:00Z' }];
    const socket = await connectAndAuth('p1');

    socket.receive({ type: 'task_restored', project_id: 'p2', data: task('t1') });
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
    expect(board.tasks).toHaveLength(0);

    board.dragging = true;
    socket.receive({ type: 'task_restored', project_id: 'p1', data: task('t1') });
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);

    board.dragging = false;
    flushSync();
    expect(board.archivedTasks).toHaveLength(0);
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('reloads the archive as well as the board when the queued batch is discarded', async () => {
    board.archivedLoaded = true;
    const socket = await connectAndAuth('p1');
    board.dragging = true;

    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      if (url.pathname === '/api/projects/p1/archived-tasks') {
        return jsonResponse(200, { tasks: [] });
      }
      return jsonResponse(200, boardPayload());
    });

    // Re-authenticating mid-drag defers the self-heal and drops the queued batch,
    // so the flush has to reload rather than replay.
    socket.serverClose();
    vi.advanceTimersByTime(1000);
    const socket2 = latestSocket();
    socket2.open();
    socket2.receive({ type: 'auth_ok' });

    board.dragging = false;
    flushSync();
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toContain('/api/projects/p1');
    expect(paths).toContain('/api/projects/p1/archived-tasks');
  });

  it('routes every attachment event to the board and drops an unlisted type', async () => {
    board.tasks = [task('t1')];
    const attachment = {
      id: 'att1',
      task_id: 't1',
      kind: 'link',
      title: null,
      description: null,
      filename: null,
      content_type: null,
      size_bytes: null,
      url: 'https://example.com/doc',
      preview_url: null,
      favicon_url: null,
      unfurl_state: 'pending',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    board.taskAttachments = { t1: [] };
    const socket = await connectAndAuth('p1');

    socket.receive({ type: 'attachment_created', project_id: 'p1', data: attachment });
    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual(['att1']);

    socket.receive({
      type: 'attachment_updated',
      project_id: 'p1',
      data: { ...attachment, unfurl_state: 'ok', title: 'Fetched' },
    });
    expect(board.taskAttachments.t1![0]).toMatchObject({ title: 'Fetched', unfurl_state: 'ok' });

    socket.receive({
      type: 'attachment_renamed',
      project_id: 'p1',
      data: { ...attachment, title: 'Never applied' },
    });
    expect(board.taskAttachments.t1![0]!.title).toBe('Fetched');

    socket.receive({
      type: 'attachment_deleted',
      project_id: 'p1',
      data: { id: 'att1', task_id: 't1' },
    });
    expect(board.taskAttachments.t1).toEqual([]);
  });

  it('holds an attachment event behind a card-overlay drag', async () => {
    board.tasks = [task('t1')];
    board.taskAttachments = { t1: [] };
    const socket = await connectAndAuth('p1');
    const attachment = {
      id: 'att1',
      task_id: 't1',
      kind: 'file',
      title: null,
      description: null,
      filename: 'spec.pdf',
      content_type: 'application/pdf',
      size_bytes: 4,
      url: null,
      preview_url: null,
      favicon_url: null,
      unfurl_state: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    board.detailDragging = true;
    socket.receive({ type: 'attachment_created', project_id: 'p1', data: attachment });
    expect(board.taskAttachments.t1).toEqual([]);

    board.detailDragging = false;
    flushSync();
    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual(['att1']);
  });

  it('holds comment events while dragging too', async () => {
    board.tasks = [task('t1')];
    board.taskComments = { t1: [] };
    const socket = await connectAndAuth('p1');
    board.dragging = true;

    socket.receive({ type: 'comment_created', project_id: 'p1', data: comment('cm1', 'queued') });
    expect(board.taskComments['t1']).toEqual([]);

    board.dragging = false;
    flushSync();
    expect(board.taskComments['t1']!.map((c) => c.id)).toEqual(['cm1']);
  });
});

describe('reconnect', () => {
  it('reconnects with backoff and refetches board + projects + archive on re-auth', async () => {
    board.currentProjectId = 'p1';
    board.archivedLoaded = true;
    realtime.connect();
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: 'auth_ok' });

    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      if (url.pathname === '/api/projects/p1/archived-tasks') {
        return jsonResponse(200, { tasks: [] });
      }
      return jsonResponse(200, boardPayload());
    });

    socket.serverClose();
    expect(realtime.status).toBe('offline');
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const socket2 = latestSocket();
    socket2.open();
    socket2.receive({ type: 'auth_ok' });

    // openapi-fetch invokes fetch after an awaited request-middleware microtask.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toContain('/api/projects');
    expect(paths).toContain('/api/projects/p1');
    expect(paths).toContain('/api/projects/p1/archived-tasks');
  });

  it('does not refetch on the very first connect', async () => {
    await connectAndAuth('p1');
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).not.toContain('/api/projects');
  });
});

describe('session revoked (4401)', () => {
  it('revalidates and clears the session on a 4401 close without reconnecting', async () => {
    const socket = await connectAndAuth('p1');
    expect(session.status).toBe('authed');
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: 'revoked' }));

    vi.useFakeTimers();
    socket.serverClose(4401);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(session.status).toBe('anon');
    expect(session.token).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects on a 4401 when the token still validates', async () => {
    const socket = await connectAndAuth('p1');
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/auth/me') {
        return jsonResponse(200, {
          id: 'u1',
          name: 'Me',
          email: 'm@e.com',
          avatar_url: null,
          email_verified: false,
        });
      }
      return jsonResponse(200, { projects: [] });
    });

    vi.useFakeTimers();
    socket.serverClose(4401);
    await vi.advanceTimersByTimeAsync(1000);

    expect(session.status).toBe('authed');
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });
});

describe('logout', () => {
  it('closes the socket and stops reconnecting on disconnect', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();
    realtime.disconnect();
    expect(socket.readyState).toBe(3);
    expect(realtime.status).toBe('offline');
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('offline notice', () => {
  it('stays quiet while the first connect is still handshaking', () => {
    vi.useFakeTimers();
    realtime.connect();
    const socket = latestSocket();
    expect(realtime.interrupted).toBe(false);

    vi.advanceTimersByTime(2999);
    expect(realtime.interrupted).toBe(false);

    socket.open();
    socket.receive({ type: 'auth_ok' });
    vi.advanceTimersByTime(60_000);

    expect(realtime.status).toBe('online');
    expect(realtime.interrupted).toBe(false);
  });

  it('warns when the first connect never completes', () => {
    vi.useFakeTimers();
    realtime.connect();

    vi.advanceTimersByTime(2999);
    expect(realtime.interrupted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(realtime.interrupted).toBe(true);
  });

  it('stays quiet across a drop that recovers inside the window', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      return jsonResponse(200, boardPayload());
    });

    socket.serverClose();
    vi.advanceTimersByTime(1000);
    const retry = latestSocket();
    retry.open();
    retry.receive({ type: 'auth_ok' });

    vi.advanceTimersByTime(60_000);
    expect(realtime.interrupted).toBe(false);
  });

  it('warns when a drop is never recovered', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();

    socket.serverClose();
    vi.advanceTimersByTime(2999);
    expect(realtime.interrupted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(realtime.interrupted).toBe(true);
  });

  it('measures one continuous outage instead of restarting on each failed retry', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();

    socket.serverClose();
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    latestSocket().serverClose();
    expect(realtime.interrupted).toBe(false);

    vi.advanceTimersByTime(1999);
    expect(realtime.interrupted).toBe(false);

    vi.advanceTimersByTime(1);
    expect(realtime.interrupted).toBe(true);
  });

  it('clears the latch when a later retry re-auths', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      return jsonResponse(200, boardPayload());
    });

    socket.serverClose();
    vi.advanceTimersByTime(3000);
    expect(realtime.interrupted).toBe(true);

    const retry = latestSocket();
    retry.open();
    retry.receive({ type: 'auth_ok' });
    expect(realtime.interrupted).toBe(false);
  });

  it('clears on disconnect and leaves no pending timers', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();

    socket.serverClose();
    vi.advanceTimersByTime(3000);
    expect(realtime.interrupted).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(2);

    realtime.disconnect();
    expect(realtime.interrupted).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(realtime.interrupted).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('starts the window on a 4401 close whose revalidation is still in flight', async () => {
    const socket = await connectAndAuth('p1');
    let resolveMe: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      async () =>
        new Promise<Response>((resolve) => {
          resolveMe = resolve;
        })
    );

    vi.useFakeTimers();
    socket.serverClose(4401);
    await vi.advanceTimersByTimeAsync(3000);

    expect(session.status).toBe('unknown');
    expect(realtime.interrupted).toBe(true);

    resolveMe!(jsonResponse(200, { id: 'u1', name: 'Me', email: 'm@e.com' }));
    await vi.advanceTimersByTimeAsync(1000);

    expect(session.status).toBe('authed');
    expect(realtime.interrupted).toBe(true);
  });
});

describe('user_updated dispatch', () => {
  beforeEach(() => {
    users.reset();
  });

  it('merges into the users store, and into the session user when self', async () => {
    const socket = await connectAndAuth('p1');

    socket.receive({
      type: 'user_updated',
      data: { id: 'u-peer', name: 'Peer', avatar_url: '/api/avatars/k' },
    });
    expect(users.byId('u-peer')?.avatar_url).toBe('/api/avatars/k');
    expect(session.user?.name).toBe('Me');

    socket.receive({
      type: 'user_updated',
      data: { id: 'u1', name: 'Me Renamed', avatar_url: null },
    });
    expect(session.user?.name).toBe('Me Renamed');
  });

  it('keeps the private account fields the public payload cannot carry', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'm@e.com', email_verified: true };

    socket.receive({
      type: 'user_updated',
      data: { id: 'u1', name: 'Me Renamed', avatar_url: '/api/avatars/k' },
    });

    expect(session.user?.name).toBe('Me Renamed');
    expect(session.user?.avatar_url).toBe('/api/avatars/k');
    expect(session.user?.email).toBe('m@e.com');
    expect(session.user?.email_verified).toBe(true);
  });

  it('refetches the account when the broadcast is about self', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'old@e.com', email_verified: true };
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        id: 'u1',
        name: 'Me',
        avatar_url: null,
        email: 'brand-new@e.com',
        email_verified: false,
      })
    );

    socket.receive({
      type: 'user_updated',
      data: { id: 'u1', name: 'Me', avatar_url: null },
    });

    await vi.waitFor(() => expect(session.user?.email).toBe('brand-new@e.com'));
    expect(session.user?.email_verified).toBe(false);
  });

  it('leaves the session user and the account alone when the broadcast is someone else', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'm@e.com', email_verified: true };

    socket.receive({
      type: 'user_updated',
      data: { id: 'u-peer', name: 'Peer', avatar_url: null },
    });

    expect(session.user?.email).toBe('m@e.com');
    expect(session.user?.email_verified).toBe(true);
    expect(users.byId('u-peer')?.name).toBe('Peer');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('drops malformed user_updated payloads', async () => {
    const socket = await connectAndAuth('p1');
    socket.receive({ type: 'user_updated', data: { id: 7 } });
    expect(users.users).toEqual([]);
    expect(session.user?.name).toBe('Me');
  });
});

describe('project_updated reaches the open board', () => {
  const me = {
    id: 'u-me',
    email: 'me@example.com',
    name: 'Me',
    avatar_url: null,
    email_verified: false,
  };

  it('demotes the open board without waiting for a refetch', async () => {
    session.user = me;
    const socket = await connectAndAuth('p1');
    board.project = {
      ...boardPayload().project,
      created_by: 'u-owner',
      member_ids: [me.id],
      members: [{ user_id: me.id, role: 'editor' }],
    };
    expect(board.canEdit).toBe(true);

    socket.receive({
      type: 'project_updated',
      project_id: 'p1',
      data: { id: 'p1', member_ids: [me.id], members: [{ user_id: me.id, role: 'viewer' }] },
    });

    expect(board.canEdit).toBe(false);
    expect(projects.projects).toHaveLength(1);
  });
});

describe('project_changed raises the unseen dot', () => {
  const SEEN = '2026-05-01T00:00:00.000Z';

  function seed(): void {
    projects.projects = [
      project({ id: 'p1', last_seen_at: SEEN }),
      project({ id: 'p2', name: 'Other', last_seen_at: SEEN }),
    ];
  }

  function dotted(): string[] {
    return projects.projects.filter((p) => p.has_unseen_changes).map((p) => p.id);
  }

  function changed(socket: FakeWebSocket, projectId: string, actorUserId?: string): void {
    socket.receive({
      type: 'project_changed',
      project_id: projectId,
      data:
        actorUserId === undefined
          ? { id: projectId }
          : { id: projectId, actor_user_id: actorUserId },
    });
  }

  it('dots a board a teammate changed while the caller is subscribed to no room', async () => {
    seed();
    const socket = await connectAndAuth(null);

    changed(socket, 'p2', 'u-them');

    expect(dotted()).toEqual(['p2']);
  });

  it('never dots the caller’s own edit, which still reaches their other devices', async () => {
    seed();
    const socket = await connectAndAuth(null);

    changed(socket, 'p1', 'u1');
    changed(socket, 'p2', 'u-them');

    expect(dotted()).toEqual(['p2']);
  });

  it('never dots an event from a pod that names no actor', async () => {
    seed();
    const socket = await connectAndAuth(null);

    changed(socket, 'p1');
    changed(socket, 'p2', 'u-them');

    expect(dotted()).toEqual(['p2']);
  });

  it('never dots the board the caller is looking at', async () => {
    seed();
    const socket = await connectAndAuth('p1');

    changed(socket, 'p1', 'u-them');
    changed(socket, 'p2', 'u-them');

    expect(dotted()).toEqual(['p2']);
  });
});

describe('invitations_changed dispatch', () => {
  beforeEach(() => {
    invitations.reset();
  });

  function invitationRequests(): number {
    return fetchMock.mock.calls.filter(
      ([input]) => new URL((input as Request).url).pathname === '/api/projects/p1/invitations'
    ).length;
  }

  async function reconnect(): Promise<void> {
    vi.useFakeTimers();
    latestSocket().serverClose();
    vi.advanceTimersByTime(1000);
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: 'auth_ok' });
    // openapi-fetch invokes fetch after an awaited request-middleware microtask.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    vi.useRealTimers();
  }

  it('refetches the pending list the share panel is showing', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: [] }));
    await invitations.load('p1');
    const socket = await connectAndAuth('p1');

    socket.receive({ type: 'invitations_changed', project_id: 'p1', data: { project_id: 'p1' } });

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([input]) => new URL((input as Request).url).pathname === '/api/projects/p1/invitations'
        )
      ).toHaveLength(2)
    );
  });

  it('ignores one for a board whose panel is not open', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: [] }));
    await invitations.load('p1');
    const socket = await connectAndAuth('p1');
    const before = fetchMock.mock.calls.length;

    socket.receive({ type: 'invitations_changed', project_id: 'p2', data: { project_id: 'p2' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock.mock.calls).toHaveLength(before);
  });

  it('re-reads an open panel after a reconnect', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: [] }));
    await invitations.load('p1');
    await connectAndAuth(null);
    expect(invitationRequests()).toBe(1);

    await reconnect();

    expect(invitationRequests()).toBe(2);
  });

  it('re-reads nothing after a reconnect with no panel open', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { invitations: [] }));
    await invitations.load('p1');
    invitations.reset();
    await connectAndAuth(null);

    await reconnect();

    expect(invitationRequests()).toBe(1);
  });
});
