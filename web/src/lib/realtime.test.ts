import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { board } from './board.svelte';
import type { BoardPayload } from './board-types';
import { projects, type Project } from './projects.svelte';
import { realtime } from './realtime.svelte';
import { session } from './session.svelte';
import { workspaces, type Workspace } from './workspaces.svelte';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) {
      return;
    }
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverClose(): void {
    this.readyState = 3;
    this.onclose?.();
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
    label_ids: [] as string[],
    assignee_ids: [] as string[],
    blocker_ids: [] as string[],
    image_count: 0,
  };
}

function boardPayload(): BoardPayload {
  return {
    project: {
      id: 'p1',
      name: 'Game',
      description: '',
      is_template: false,
      archived_at: null,
      created_by: null,
      workspace_id: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    columns: [{ id: 'c1', name: 'Todo', position: 1000, is_done: false }],
    tasks: [],
    labels: [],
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Game',
    description: '',
    is_template: false,
    archived_at: null,
    created_by: null,
    workspace_id: null,
    created_at: '2026-01-01T00:00:00Z',
    open_task_count: 0,
    done_task_count: 0,
    ...overrides,
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Team',
    created_by: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    member_ids: ['u1'],
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
  workspaces.reset();
  localStorage.setItem('cp.token', 'test-token');
  fetchMock.mockResolvedValue(jsonResponse(200, { id: 'u1', name: 'Me', email: 'm@e.com' }));
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

  it('ignores board events for a different project', async () => {
    const socket = await connectAndAuth('p1');
    socket.receive({ type: 'task_created', project_id: 'p-other', data: task('tx') });
    expect(board.tasks).toHaveLength(0);
  });
});

describe('project and workspace event application', () => {
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

  it('upserts and removes workspaces', () => {
    workspaces.applyRealtime({ type: 'workspace_created', project_id: null, data: workspace() });
    workspaces.applyRealtime({ type: 'workspace_created', project_id: null, data: workspace() });
    expect(workspaces.workspaces).toHaveLength(1);
    workspaces.applyRealtime({
      type: 'workspace_updated',
      project_id: null,
      data: workspace({ name: 'Renamed' }),
    });
    expect(workspaces.workspaces[0]!.name).toBe('Renamed');
    workspaces.applyRealtime({ type: 'workspace_deleted', project_id: null, data: { id: 'w1' } });
    expect(workspaces.workspaces).toHaveLength(0);
  });

  it('drops a workspace when a members_set removes the caller', () => {
    workspaces.workspaces = [workspace()];
    workspaces.applyRealtime({
      type: 'workspace_members_set',
      project_id: null,
      data: workspace({ member_ids: ['u9'] }),
    });
    expect(workspaces.workspaces).toHaveLength(0);
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
});

describe('reconnect', () => {
  it('reconnects with backoff and refetches board + projects on re-auth', async () => {
    board.currentProjectId = 'p1';
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
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }

    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).toContain('/api/projects');
    expect(paths).toContain('/api/projects/p1');
  });

  it('does not refetch on the very first connect', async () => {
    await connectAndAuth('p1');
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).not.toContain('/api/projects');
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
