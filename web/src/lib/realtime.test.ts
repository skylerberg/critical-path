import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { board } from './board.svelte';
import { boardAnnouncer } from './board-announcer.svelte';
import { connectivity } from './connectivity.svelte';
import { invitations } from './invitations.svelte';
import type { BoardPayload, BoardTask, TaskComment } from './board-types';
import { outbox } from './outbox.svelte';
import { projects, type Project } from './projects.svelte';
import { realtime } from './realtime.svelte';
import { session } from './session.svelte';
import { realtimeCoverage } from './realtime-coverage.svelte';
import { taskSeries } from './taskSeries.svelte';
import { router } from './router.svelte';
import { projectHref } from './short-links';
import { testUuid } from './test-ids';
import { users } from './users.svelte';
import { realtimeEvent } from './realtime-test-events';
import type { RealtimeEventType } from './realtime-types';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  // `data` is unknown rather than string so `receiveRaw` can deliver the frames
  // a real socket can and `JSON.stringify` cannot.
  onmessage: ((event: { data: unknown }) => void) | null = null;
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

  // Delivers the frame verbatim, which is the only way to reach the guards
  // #onMessage opens with: a binary frame, one that is not JSON at all, one whose
  // type is not a string.
  receiveRaw(data: unknown): void {
    this.onmessage?.({ data });
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

// Annotated, not inferred: an inferred literal reaches `realtimeEvent()` as a
// function return, where excess-property checking no longer applies and a field
// the API does not have goes unnoticed — `image_count` sat here for months.
function task(id: string, columnId = 'c1', position = 1000): BoardTask {
  return {
    id,
    column_id: columnId,
    title: id,
    description: null,
    sort_key: `V0${String(Math.round(position)).padStart(8, '0')}1`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    column_since: '2026-01-01T00:00:00Z',
    label_ids: [],
    assignee_ids: [],
    blocker_ids: [],
    open_cross_project_blocker_count: 0,
    cover_image_url: null,
    due_date: null,
    comment_count: 0,
    checklist_item_count: 0,
    checklist_done_count: 0,
    attachment_count: 0,
  };
}

function comment(id: string, text: string): TaskComment {
  return {
    id,
    task_id: 't1',
    user_id: 'u1',
    body: {
      type: 'doc' as const,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
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
    columns: [{ id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false }],
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
    sort_key: null,
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
  boardAnnouncer.reset();
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
  boardAnnouncer.reset();
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

  // What the stores read to decide a revalidating fetch would learn nothing. A
  // token that outlives a gap is worse than no token at all: it would let a board
  // that missed events go on looking current.
  it('names the project it is carrying, and stops the moment it is not', async () => {
    await connectAndAuth('p1');
    const carried = realtimeCoverage.tokenFor('p1');
    expect(carried).not.toBeNull();
    expect(realtimeCoverage.holds('p1', carried)).toBe(true);
    expect(realtimeCoverage.tokenFor('p2')).toBeNull();

    board.currentProjectId = 'p2';
    flushSync();
    expect(realtimeCoverage.holds('p1', carried)).toBe(false);

    const moved = realtimeCoverage.tokenFor('p2');
    latestSocket().serverClose();
    expect(realtimeCoverage.tokenFor('p2')).toBeNull();
    expect(realtimeCoverage.holds('p2', moved)).toBe(false);
  });

  it('carries nothing for a read-only board, which it never subscribed to', async () => {
    board.readonly = true;
    await connectAndAuth('p1');

    expect(realtimeCoverage.tokenFor('p1')).toBeNull();
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

// #dispatch decides an event's fate by set membership alone: a type missing from
// BOARD_EVENTS, SERIES_EVENTS or PROJECT_EVENTS matches no branch and is dropped
// without a sound. Every other case in this file hands the event to a store
// directly, so this describe is the only thing standing over the routing.
describe('routing a frame to the store that owns it', () => {
  type Destination =
    | 'board'
    | 'board-series'
    | 'series'
    | 'projects'
    | 'unseen-dot'
    | 'invitations'
    | 'users'
    | 'account';

  // Keyed by the generated union, which is what makes it exhaustive both ways: a
  // type the API adds stops this compiling until someone routes it, and one it
  // retires leaves an excess key here.
  const DESTINATIONS: Record<RealtimeEventType, Destination[]> = {
    task_created: ['board'],
    task_updated: ['board'],
    task_deleted: ['board'],
    task_archived: ['board'],
    task_restored: ['board'],
    task_relations_set: ['board'],
    cross_project_blockers_changed: ['board'],
    column_created: ['board'],
    column_updated: ['board'],
    column_deleted: ['board'],
    column_tasks_moved: ['board'],
    column_tasks_archived: ['board'],
    column_tasks_reordered: ['board'],
    bulk_tasks_moved: ['board'],
    bulk_tasks_archived: ['board'],
    bulk_tasks_relations_set: ['board'],
    label_created: ['board'],
    label_updated: ['board'],
    label_deleted: ['board'],
    comment_created: ['board'],
    comment_updated: ['board'],
    comment_deleted: ['board'],
    checklist_item_created: ['board'],
    checklist_item_updated: ['board'],
    checklist_item_deleted: ['board'],
    attachment_created: ['board'],
    attachment_updated: ['board'],
    attachment_deleted: ['board'],
    series_created: ['series', 'board-series'],
    series_updated: ['series', 'board-series'],
    series_deleted: ['series', 'board-series'],
    project_created: ['projects'],
    // The open board too: what it may be edited into is read off this payload.
    project_updated: ['projects', 'board'],
    project_deleted: ['projects'],
    project_position_updated: ['projects'],
    project_seen: ['projects'],
    project_changed: ['unseen-dot'],
    invitations_changed: ['invitations'],
    user_updated: ['users'],
    account_updated: ['account'],
    // Deliberately nowhere: the API closes the socket 4401 alongside it, and the
    // close is what this client acts on.
    sessions_revoked: [],
  };

  // Only the two payloads #dispatch itself reads. Every other branch hands the
  // data straight to a store, which is stubbed here — routing is the subject,
  // and what each store does with the payload is tested against that store.
  const FRAMES: Partial<Record<RealtimeEventType, { projectId?: string; data: unknown }>> = {
    account_updated: {
      data: { id: 'u1', name: 'Renamed', avatar_url: null, email: 'm@e.com', email_verified: true },
    },
    project_changed: { projectId: 'p2', data: { id: 'p2', actor_user_id: 'u-them' } },
  };

  it('lands every type the API publishes where its set says, and nowhere else', async () => {
    const spies = {
      board: vi.spyOn(board, 'applyRealtime').mockImplementation(() => {}),
      'board-series': vi.spyOn(board, 'applySeriesRealtime').mockImplementation(() => {}),
      series: vi.spyOn(taskSeries, 'applyRealtime').mockImplementation(() => {}),
      projects: vi.spyOn(projects, 'applyRealtime').mockImplementation(() => {}),
      'unseen-dot': vi.spyOn(projects, 'markChanged').mockImplementation(() => {}),
      invitations: vi.spyOn(invitations, 'applyRealtime').mockImplementation(() => {}),
      // Null rather than undefined: the caller compares the return against null
      // before reading an id off it.
      users: vi.spyOn(users, 'applyRealtime').mockReturnValue(null),
    };
    const named = Object.keys(spies) as (keyof typeof spies)[];

    try {
      const socket = await connectAndAuth('p1');
      const reached: Record<string, Destination[]> = {};

      for (const type of Object.keys(DESTINATIONS) as RealtimeEventType[]) {
        for (const spy of Object.values(spies)) {
          spy.mockClear();
        }
        session.user = {
          id: 'u1',
          name: 'Me',
          avatar_url: null,
          email: 'm@e.com',
          email_verified: false,
        };
        const frame = FRAMES[type];

        socket.receive({ type, project_id: frame?.projectId ?? 'p1', data: frame?.data ?? {} });

        const landed: Destination[] = named.filter((name) => spies[name].mock.calls.length > 0);
        if (session.user?.name !== 'Me') {
          landed.push('account');
        }
        reached[type] = landed.sort();
      }

      expect(reached).toEqual(
        Object.fromEntries(
          Object.entries(DESTINATIONS).map(([type, destinations]) => [
            type,
            [...destinations].sort(),
          ])
        )
      );
    } finally {
      for (const spy of Object.values(spies)) {
        spy.mockRestore();
      }
    }
  });
});

describe('board event application', () => {
  beforeEach(() => {
    board.currentProjectId = 'p1';
  });

  it('upserts and is idempotent for task_created/updated', () => {
    const event = realtimeEvent('task_created', task('t1'), 'p1');
    board.applyRealtime(event);
    board.applyRealtime(event);
    expect(board.tasks).toHaveLength(1);
    board.applyRealtime(realtimeEvent('task_updated', { ...task('t1'), title: 'Renamed' }, 'p1'));
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.title).toBe('Renamed');
  });

  it('adopts a due date set by a teammate, and its removal', () => {
    board.tasks = [task('t1')];

    board.applyRealtime(
      realtimeEvent('task_updated', { ...task('t1'), due_date: '2026-08-03' }, 'p1')
    );
    expect(board.tasks[0]!.due_date).toBe('2026-08-03');

    board.applyRealtime(realtimeEvent('task_updated', { ...task('t1'), due_date: null }, 'p1'));
    expect(board.tasks[0]!.due_date).toBeNull();
  });

  it('removes on task_deleted and strips it from other blocker_ids', () => {
    board.tasks = [task('t1'), { ...task('t2'), blocker_ids: ['t1'] }];
    board.applyRealtime(realtimeEvent('task_deleted', { id: 't1' }, 'p1'));
    board.applyRealtime(realtimeEvent('task_deleted', { id: 't1' }, 'p1'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t2']);
    expect(board.tasks[0]!.blocker_ids).toEqual([]);
  });

  it('overwrites the three arrays on task_relations_set', () => {
    board.tasks = [task('t1')];
    board.applyRealtime(
      realtimeEvent(
        'task_relations_set',
        {
          task_id: 't1',
          label_ids: ['l1'],
          assignee_ids: ['u2'],
          blocker_ids: ['t9'],
          open_cross_project_blocker_count: 0,
        },
        'p1'
      )
    );
    expect(board.tasks[0]).toMatchObject({
      label_ids: ['l1'],
      assignee_ids: ['u2'],
      blocker_ids: ['t9'],
      open_cross_project_blocker_count: 0,
    });
  });

  it('carries the cross-project count on task_relations_set', () => {
    board.tasks = [{ ...task('t1'), open_cross_project_blocker_count: 3 }];
    board.applyRealtime(
      realtimeEvent(
        'task_relations_set',
        {
          task_id: 't1',
          label_ids: [],
          assignee_ids: [],
          blocker_ids: [],
          open_cross_project_blocker_count: 1,
        },
        'p1'
      )
    );
    expect(board.tasks[0]?.open_cross_project_blocker_count).toBe(1);
  });

  it('applies a bare recount from cross_project_blockers_changed', () => {
    board.tasks = [
      { ...task('t1'), open_cross_project_blocker_count: 2 },
      { ...task('t2'), open_cross_project_blocker_count: 5 },
    ];
    board.applyRealtime(
      realtimeEvent(
        'cross_project_blockers_changed',
        { tasks: [{ task_id: 't1', open_cross_project_blocker_count: 0 }] },
        'p1'
      )
    );
    expect(board.tasks[0]?.open_cross_project_blocker_count).toBe(0);
    // Untouched: the event names only the cards whose count moved.
    expect(board.tasks[1]?.open_cross_project_blocker_count).toBe(5);
  });

  it('ignores a recount aimed at another project', () => {
    board.tasks = [{ ...task('t1'), open_cross_project_blocker_count: 2 }];
    board.applyRealtime(
      realtimeEvent(
        'cross_project_blockers_changed',
        { tasks: [{ task_id: 't1', open_cross_project_blocker_count: 0 }] },
        'p2'
      )
    );
    expect(board.tasks[0]?.open_cross_project_blocker_count).toBe(2);
  });

  it('upserts columns sorted by sort key', () => {
    board.applyRealtime(
      realtimeEvent(
        'column_created',
        { id: 'c2', name: 'Done', sort_key: 'V0000005001', is_done: true },
        'p1'
      )
    );
    board.applyRealtime(
      realtimeEvent(
        'column_created',
        { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
        'p1'
      )
    );
    expect(board.columns.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('removes the column and applies moved_tasks on column_deleted', () => {
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true },
    ];
    board.tasks = [task('t1', 'c1'), task('t2', 'c1')];
    board.applyRealtime(
      realtimeEvent(
        'column_deleted',
        {
          id: 'c1',
          moved_tasks: [{ id: 't1', column_id: 'c2', sort_key: 'V0000030001' }],
        },
        'p1'
      )
    );
    expect(board.columns.map((c) => c.id)).toEqual(['c2']);
    expect(board.tasks.find((t) => t.id === 't1')).toMatchObject({
      column_id: 'c2',
      sort_key: 'V0000030001',
    });
    expect(board.tasks.find((t) => t.id === 't2')).toBeUndefined();
  });

  it('applies label create/update/delete and strips deleted labels from tasks', () => {
    board.tasks = [{ ...task('t1'), label_ids: ['l1'] }];
    board.filterLabelIds = ['l1'];
    board.applyRealtime(
      realtimeEvent('label_created', { id: 'l1', name: 'art', color: '#f00' }, 'p1')
    );
    expect(board.labels).toHaveLength(1);
    board.applyRealtime(realtimeEvent('label_deleted', { id: 'l1' }, 'p1'));
    expect(board.labels).toHaveLength(0);
    expect(board.tasks[0]!.label_ids).toEqual([]);
    expect(board.filterLabelIds).toEqual([]);
  });

  it('clears the cover when attachment_deleted reports it is gone', () => {
    board.tasks = [{ ...task('t1'), cover_image_url: '/api/images/img2' }];

    board.applyRealtime(
      realtimeEvent(
        'attachment_deleted',
        { id: 'img2', task_id: 't1', attachment_count: 1, cover_image_url: null },
        'p1'
      )
    );

    expect(board.tasks[0]!.cover_image_url).toBeNull();
  });

  it('keeps a cover that survives someone else deleting another attachment', () => {
    board.tasks = [{ ...task('t1'), cover_image_url: '/api/images/img1' }];

    board.applyRealtime(
      realtimeEvent(
        'attachment_deleted',
        {
          id: 'img2',
          task_id: 't1',
          attachment_count: 1,
          cover_image_url: '/api/images/img1',
        },
        'p1'
      )
    );

    expect(board.tasks[0]!.cover_image_url).toBe('/api/images/img1');
  });

  // A pod that predates the field omits it; absent has to read as "no cover"
  // rather than leaving undefined on the card.
  it('reads an attachment_deleted without the field as no cover, never undefined', () => {
    board.tasks = [{ ...task('t1'), cover_image_url: '/api/images/img1' }];

    board.applyRealtime(
      realtimeEvent('attachment_deleted', { id: 'img2', task_id: 't1', attachment_count: 1 }, 'p1')
    );

    expect(board.tasks[0]!.cover_image_url).toBeNull();
  });

  it('adopts a cover chosen by a teammate on task_updated', () => {
    board.tasks = [task('t1')];

    board.applyRealtime(
      realtimeEvent('task_updated', { ...task('t1'), cover_image_url: '/api/images/img7' }, 'p1')
    );

    expect(board.tasks[0]!.cover_image_url).toBe('/api/images/img7');
  });

  it('ignores board events for a different project', async () => {
    const socket = await connectAndAuth('p1');
    socket.receive(realtimeEvent('task_created', task('tx'), 'p-other'));
    expect(board.tasks).toHaveLength(0);
  });

  it('routes the three comment events off the wire into the board store', async () => {
    board.tasks = [task('t1')];
    board.taskComments = { t1: [] };
    const socket = await connectAndAuth('p1');

    socket.receive(
      realtimeEvent('comment_created', { ...comment('cm1', 'hello'), comment_count: 1 }, 'p1')
    );
    expect(board.taskComments['t1']!.map((c) => c.id)).toEqual(['cm1']);
    expect(board.tasks[0]!.comment_count).toBe(1);

    socket.receive(realtimeEvent('comment_updated', comment('cm1', 'edited'), 'p1'));
    expect(JSON.stringify(board.taskComments['t1']![0]!.body)).toContain('edited');

    socket.receive(
      realtimeEvent('comment_deleted', { id: 'cm1', task_id: 't1', comment_count: 0 }, 'p1')
    );
    expect(board.taskComments['t1']).toEqual([]);
    expect(board.tasks[0]!.comment_count).toBe(0);
  });

  it('ignores a comment event for a different project', async () => {
    board.tasks = [task('t1')];
    board.taskComments = { t1: [] };
    const socket = await connectAndAuth('p1');

    socket.receive(
      realtimeEvent(
        'comment_created',
        { ...comment('cm1', 'elsewhere'), comment_count: 1 },
        'p-other'
      )
    );

    expect(board.taskComments['t1']).toEqual([]);
    expect(board.tasks[0]!.comment_count).toBe(0);
  });
});

describe('project event application', () => {
  it('upserts and removes projects', () => {
    projects.applyRealtime(realtimeEvent('project_created', project(), 'p1'));
    projects.applyRealtime(realtimeEvent('project_created', project(), 'p1'));
    expect(projects.projects).toHaveLength(1);
    projects.applyRealtime(realtimeEvent('project_updated', { id: 'p1', name: 'Renamed' }, 'p1'));
    expect(projects.projects[0]!.name).toBe('Renamed');
    projects.applyRealtime(realtimeEvent('project_deleted', { id: 'p1' }, 'p1'));
    expect(projects.projects).toHaveLength(0);
  });

  it('merges member_ids from a project_updated membership change', () => {
    projects.projects = [project({ member_ids: ['u2'] })];
    projects.applyRealtime(
      realtimeEvent('project_updated', { id: 'p1', member_ids: ['u2', 'u3'] }, 'p1')
    );
    expect(projects.projects[0]!.member_ids).toEqual(['u2', 'u3']);
    expect(projects.projects[0]!.name).toBe('Game');
  });

  it('upserts an unknown project from a project_updated broadcast', () => {
    projects.applyRealtime(
      realtimeEvent('project_updated', { id: 'p9', name: 'Gained', member_ids: ['u1'] }, 'p9')
    );
    expect(projects.projects).toHaveLength(1);
    expect(projects.projects[0]!.member_ids).toEqual(['u1']);
  });

  it('evicts the project on project_deleted when access is lost', () => {
    projects.projects = [project(), project({ id: 'p2', name: 'Other' })];
    projects.applyRealtime(realtimeEvent('project_deleted', { id: 'p1' }, 'p1'));
    expect(projects.projects.map((p) => p.id)).toEqual(['p2']);
  });

  // The payload is what the server actually publishes: `{ id, sort_key }` and no
  // `position`, which is what this event carried before ordering moved to keys.
  it('merges the sort key from a project_position_updated wire event', async () => {
    projects.projects = [project()];
    const socket = await connectAndAuth(null);
    socket.receive(
      realtimeEvent('project_position_updated', { id: 'p1', sort_key: 'V0000002501' }, null)
    );
    expect(projects.projects[0]!.sort_key).toBe('V0000002501');
  });
});

describe('series event application', () => {
  const seriesRow = {
    id: 's1',
    project_id: 'p1',
    title: 'Weekly review',
    status: 'active' as const,
  };

  beforeEach(async () => {
    board.currentProjectId = 'p1';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { series: [] }));
    await taskSeries.load('p1');
    fetchMock.mockReset();
  });

  it('routes the three series events off the wire into the series store', async () => {
    const socket = await connectAndAuth('p1');

    socket.receive(realtimeEvent('series_created', seriesRow, 'p1'));
    expect(taskSeries.list.map((row) => row.id)).toEqual(['s1']);

    socket.receive(realtimeEvent('series_updated', { ...seriesRow, title: 'Renamed' }, 'p1'));
    expect(taskSeries.list[0]!.title).toBe('Renamed');

    socket.receive(realtimeEvent('series_deleted', { id: 's1' }, 'p1'));
    expect(taskSeries.list).toEqual([]);
  });

  it('ignores a series event for a different project', async () => {
    const socket = await connectAndAuth('p1');

    socket.receive(
      realtimeEvent('series_created', { ...seriesRow, project_id: 'p-other' }, 'p-other')
    );

    expect(taskSeries.list).toEqual([]);
  });

  it('applies a series event while a drag is live instead of queueing it', async () => {
    const socket = await connectAndAuth('p1');
    board.dragging = true;

    socket.receive(realtimeEvent('series_created', seriesRow, 'p1'));

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
    socket.receive(realtimeEvent('task_created', task('t1'), 'p1'));
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
      sort_key: 'V0000010001',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      checklist_item_count: 1,
      checklist_done_count: 0,
    };

    board.detailDragging = true;
    socket.receive(realtimeEvent('checklist_item_created', item, 'p1'));
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

    socket.receive(realtimeEvent('task_archived', archived, 'p2'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);

    board.dragging = true;
    socket.receive(realtimeEvent('task_archived', archived, 'p1'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);

    board.dragging = false;
    flushSync();
    expect(board.tasks).toHaveLength(0);
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('treats column_tasks_moved as a board event: project-filtered, queued, then applied', async () => {
    board.columns = [
      { id: 'c1', name: 'Todo', sort_key: 'V0000010001', is_done: false },
      { id: 'c2', name: 'Done', sort_key: 'V0000020001', is_done: true },
    ];
    board.tasks = [task('t1', 'c1')];
    const socket = await connectAndAuth('p1');
    const data = {
      column_id: 'c1',
      target_column_id: 'c2',
      moved_tasks: [{ id: 't1', column_id: 'c2', sort_key: 'V0000030001' }],
    };

    socket.receive(realtimeEvent('column_tasks_moved', data, 'p2'));
    expect(board.tasks[0]!.column_id).toBe('c1');

    board.dragging = true;
    socket.receive(realtimeEvent('column_tasks_moved', data, 'p1'));
    expect(board.tasks[0]!.column_id).toBe('c1');

    board.dragging = false;
    flushSync();
    expect(board.tasks[0]).toMatchObject({ column_id: 'c2', sort_key: 'V0000030001' });
    expect(board.columns.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('treats column_tasks_reordered as a board event: project-filtered, queued, then applied', async () => {
    board.tasks = [task('t1', 'c1', 1000), task('t2', 'c1', 2000)];
    const socket = await connectAndAuth('p1');
    const data = {
      column_id: 'c1',
      moved_tasks: [
        { id: 't1', column_id: 'c1', sort_key: 'V0000020001' },
        { id: 't2', column_id: 'c1', sort_key: 'V0000010001' },
      ],
    };

    socket.receive(realtimeEvent('column_tasks_reordered', data, 'p2'));
    expect(board.tasksInColumn('c1').map((t) => t.id)).toEqual(['t1', 't2']);

    board.dragging = true;
    socket.receive(realtimeEvent('column_tasks_reordered', data, 'p1'));
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

    socket.receive(realtimeEvent('column_tasks_archived', data, 'p2'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1', 't2']);

    board.dragging = true;
    socket.receive(realtimeEvent('column_tasks_archived', data, 'p1'));
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

    socket.receive(realtimeEvent('task_restored', task('t1'), 'p2'));
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);
    expect(board.tasks).toHaveLength(0);

    board.dragging = true;
    socket.receive(realtimeEvent('task_restored', task('t1'), 'p1'));
    expect(board.archivedTasks.map((t) => t.id)).toEqual(['t1']);

    board.dragging = false;
    flushSync();
    expect(board.archivedTasks).toHaveLength(0);
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('defers the reconnect refetch past the drag, then discards what queued behind it', async () => {
    board.archivedLoaded = true;
    board.tasks = [task('t-before')];
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
    const paths = (): string[] =>
      fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);

    // Re-authenticating mid-drag defers the self-heal and drops the queued batch,
    // so the flush has to reload rather than replay.
    socket.serverClose();
    vi.advanceTimersByTime(1000);
    const socket2 = latestSocket();
    socket2.open();
    socket2.receive({ type: 'auth_ok' });
    socket2.receive(realtimeEvent('task_created', task('t-queued'), 'p1'));

    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }
    // The one read that waits. A board replaced wholesale mid-gesture rewrites
    // the very arrays svelte-dnd-action is mutating; the account and the project
    // list are not the board and go out at once.
    expect(paths()).not.toContain('/api/projects/p1');
    expect(paths()).toContain('/api/projects');
    expect(board.tasks.map((t) => t.id)).toEqual(['t-before']);

    board.dragging = false;
    flushSync();
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    expect(paths()).toContain('/api/projects/p1');
    expect(paths()).toContain('/api/projects/p1/archived-tasks');
    // The refetched board wins outright: an event that queued during the drag
    // describes a change the reload already carries, and replaying it on top
    // would apply it twice against a board it was never computed from.
    expect(board.tasks).toEqual([]);
  });

  it('routes every attachment event to the board and drops an unlisted type', async () => {
    board.tasks = [task('t1')];
    const attachment = {
      id: 'att1',
      task_id: 't1',
      kind: 'link' as const,
      title: null,
      description: null,
      filename: null,
      content_type: null,
      size_bytes: null,
      url: 'https://example.com/doc',
      preview_url: null,
      favicon_url: null,
      unfurl_state: 'pending' as const,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    board.taskAttachments = { t1: [] };
    const socket = await connectAndAuth('p1');

    socket.receive(realtimeEvent('attachment_created', attachment, 'p1'));
    expect(board.taskAttachments.t1!.map((a) => a.id)).toEqual(['att1']);

    socket.receive(
      realtimeEvent(
        'attachment_updated',
        { ...attachment, unfurl_state: 'ok' as const, title: 'Fetched' },
        'p1'
      )
    );
    expect(board.taskAttachments.t1![0]).toMatchObject({ title: 'Fetched', unfurl_state: 'ok' });

    // Raw, not realtimeEvent: the point is a type the API does not publish, which
    // the builder rightly refuses to construct.
    socket.receive({
      type: 'attachment_renamed',
      project_id: 'p1',
      data: { ...attachment, title: 'Never applied' },
    });
    expect(board.taskAttachments.t1![0]!.title).toBe('Fetched');

    socket.receive(realtimeEvent('attachment_deleted', { id: 'att1', task_id: 't1' }, 'p1'));
    expect(board.taskAttachments.t1).toEqual([]);
  });

  it('holds an attachment event behind a card-overlay drag', async () => {
    board.tasks = [task('t1')];
    board.taskAttachments = { t1: [] };
    const socket = await connectAndAuth('p1');
    const attachment = {
      id: 'att1',
      task_id: 't1',
      kind: 'file' as const,
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
    socket.receive(realtimeEvent('attachment_created', attachment, 'p1'));
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

    socket.receive(
      realtimeEvent('comment_created', { ...comment('cm1', 'queued'), comment_count: 1 }, 'p1')
    );
    expect(board.taskComments['t1']).toEqual([]);

    board.dragging = false;
    flushSync();
    expect(board.taskComments['t1']!.map((c) => c.id)).toEqual(['cm1']);
  });
});

describe('reconnect', () => {
  it('reconnects with backoff and refetches board + projects + archive + account on re-auth', async () => {
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
      if (url.pathname === '/api/auth/me') {
        return jsonResponse(200, {
          id: 'u1',
          name: 'Me',
          avatar_url: null,
          email: 'm@e.com',
          email_verified: false,
        });
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
    // account_updated is delivered, not replayed, so a reconnect is the only
    // thing that can recover one published while the socket was down.
    expect(paths).toContain('/api/auth/me');
  });

  // A refetch that ran first would replace the user's unsent changes on screen
  // with a board that predates them, only for the replay to put them back.
  it('sends everything waiting before it reads the board back', async () => {
    // The app launched with no network: the session could not be checked, the
    // board came from this device, and a change was made anyway. The first
    // socket to connect is therefore the first read of anything.
    session.status = 'offline';
    board.currentProjectId = 'p1';

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await outbox.submit({
      projectId: 'p1',
      entityId: 't1',
      label: 'Renamed a card',
      request: {
        method: 'PATCH',
        path: '/api/tasks/{id}',
        pathParams: { id: 't1' },
        body: { title: 'mine' },
      },
    });
    expect(outbox.count).toBe(1);

    const order: string[] = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation((input) => {
      const request = input as Request;
      order.push(`${request.method} ${new URL(request.url).pathname}`);
      if (new URL(request.url).pathname === '/api/projects') {
        return Promise.resolve(jsonResponse(200, { projects: [] }));
      }
      return Promise.resolve(jsonResponse(200, boardPayload()));
    });

    realtime.connect();
    const socket = latestSocket();
    socket.open();
    socket.receive({ type: 'auth_ok' });

    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(outbox.count).toBe(0);
    const replay = order.indexOf('PATCH /api/tasks/t1');
    const refetch = order.indexOf('GET /api/projects/p1');
    expect(replay).toBeGreaterThanOrEqual(0);
    expect(refetch).toBeGreaterThan(replay);
  });

  it('does not refetch on the very first connect', async () => {
    await connectAndAuth('p1');
    const paths = fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
    expect(paths).not.toContain('/api/projects');
    expect(paths).not.toContain('/api/auth/me');
  });
});

// The schedule itself, which every other reconnect case here is satisfied by a
// constant one second: each retry is closed the instant it opens, so the only
// thing deciding when the next socket appears is the backoff.
describe('the reconnect schedule', () => {
  it('doubles each wait and then holds at thirty seconds', async () => {
    const socket = await connectAndAuth('p1');
    connectivity.noteUnreachable();
    vi.useFakeTimers();

    socket.serverClose();
    let opened = 1;
    for (const wait of [1000, 2000, 4000, 8000, 16_000, 30_000]) {
      vi.advanceTimersByTime(wait - 1);
      expect(FakeWebSocket.instances).toHaveLength(opened);
      vi.advanceTimersByTime(1);
      opened += 1;
      expect(FakeWebSocket.instances).toHaveLength(opened);
      latestSocket().serverClose();
    }

    // Doubling 30s would be a minute; the ceiling is what keeps it at 30s.
    vi.advanceTimersByTime(29_999);
    expect(FakeWebSocket.instances).toHaveLength(opened);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(opened + 1);
  });

  it('starts over at one second once a retry re-authenticates', async () => {
    const socket = await connectAndAuth('p1');
    connectivity.noteUnreachable();
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (input) => {
      const url = new URL((input as Request).url);
      if (url.pathname === '/api/projects') {
        return jsonResponse(200, { projects: [] });
      }
      return jsonResponse(200, boardPayload());
    });

    // Two failed retries take the next wait to four seconds.
    socket.serverClose();
    vi.advanceTimersByTime(1000);
    latestSocket().serverClose();
    vi.advanceTimersByTime(2000);
    expect(FakeWebSocket.instances).toHaveLength(3);

    const revived = latestSocket();
    revived.open();
    revived.receive({ type: 'auth_ok' });

    // The connection that just succeeded is what resets it; without that the
    // next drop would wait out the four seconds the outage left behind.
    revived.serverClose();
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });
});

describe('the socket as a reachability signal', () => {
  // The board's revalidating reads are skipped for as long as this socket holds
  // coverage, so while it is healthy there is no HTTP traffic left to answer the
  // question. The API heartbeats every 30s, which makes the socket itself the
  // answer — and without this the app sits behind an offline notice applying
  // live events from the very server it says it cannot reach.
  it('counts any frame as proof, the heartbeat included', async () => {
    const socket = await connectAndAuth('p1');
    connectivity.noteUnreachable();
    expect(connectivity.reachable).toBe(false);

    socket.receive({ type: 'ping' });

    expect(connectivity.reachable).toBe(true);
  });

  it('counts a frame it has no handler for', async () => {
    const socket = await connectAndAuth('p1');
    connectivity.noteUnreachable();

    socket.receive({ type: 'something_this_client_has_never_heard_of' });

    expect(connectivity.reachable).toBe(true);
  });

  // Counted before the frame is understood, not after: a frame this client
  // cannot even parse still crossed the network, and it is the only evidence
  // there is while the socket is up and the revalidating reads are skipped.
  it('counts a frame it could not parse at all', async () => {
    const socket = await connectAndAuth('p1');
    connectivity.noteUnreachable();
    expect(connectivity.reachable).toBe(false);

    socket.receiveRaw('{not json');

    expect(connectivity.reachable).toBe(true);
  });

  // The backoff is sized for an outage that is still going, and reaching a
  // maximum of 30s is the ordinary state after a phone has been in the
  // background. Waiting it out keeps the indicator saying "Offline" long after
  // the network came back.
  it('reconnects at once when something else reaches the server', async () => {
    const socket = await connectAndAuth('p1');
    connectivity.noteUnreachable();
    socket.serverClose();
    expect(FakeWebSocket.instances).toHaveLength(1);

    connectivity.noteReached();
    flushSync();

    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('resets the wait so a later drop is not still carrying the old backoff', async () => {
    const socket = await connectAndAuth('p1');
    vi.useFakeTimers();
    connectivity.noteUnreachable();

    // Four failures take the backoff from 1s to 16s. Each wait is advanced past
    // the ceiling rather than by its own length, so this does not restate the
    // schedule it is here to observe.
    socket.serverClose();
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.advanceTimersByTime(30_000);
      latestSocket().serverClose();
    }
    expect(FakeWebSocket.instances).toHaveLength(4);

    connectivity.noteReached();
    flushSync();
    expect(FakeWebSocket.instances).toHaveLength(5);

    // Back to the first interval rather than resuming where the outage left off.
    latestSocket().serverClose();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(6);
  });

  it('leaves a handshake already in flight alone', async () => {
    await connectAndAuth('p1');
    connectivity.noteUnreachable();

    // Still open: nothing to reconnect, and opening a second socket over a live
    // one would leak it.
    connectivity.noteReached();
    flushSync();

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('frames that are not events', () => {
  // Every case pairs the bad frame with a good one afterwards, because "nothing
  // was applied" is also what a socket that died on the bad frame looks like.
  it('drops a binary frame and keeps applying the next good event', async () => {
    const socket = await connectAndAuth('p1');

    socket.receiveRaw(new ArrayBuffer(8));
    expect(board.tasks).toEqual([]);

    socket.receive(realtimeEvent('task_created', task('t1'), 'p1'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('drops a frame that is not JSON and keeps applying the next good event', async () => {
    const socket = await connectAndAuth('p1');

    socket.receiveRaw('{not json');
    expect(board.tasks).toEqual([]);

    socket.receive(realtimeEvent('task_created', task('t1'), 'p1'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  // Not a hypothetical shape: the frame is a type this client knows and a pod that
  // predates the payload it now carries. #dispatch destructures `event.data`, so
  // without the guard this throws out of onmessage rather than being ignored.
  it('drops a known type that carries no payload and keeps applying the next good event', async () => {
    const socket = await connectAndAuth('p1');

    socket.receiveRaw(JSON.stringify({ type: 'project_changed', project_id: 'p2' }));
    expect(board.tasks).toEqual([]);

    socket.receive(realtimeEvent('task_created', task('t1'), 'p1'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('drops a frame whose type is not a string and keeps applying the next good event', async () => {
    const socket = await connectAndAuth('p1');

    socket.receiveRaw(JSON.stringify({ type: 7, project_id: 'p1', data: task('t1') }));
    expect(board.tasks).toEqual([]);

    socket.receive(realtimeEvent('task_created', task('t1'), 'p1'));
    expect(board.tasks.map((t) => t.id)).toEqual(['t1']);
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

  it('does not blank the app while revalidating a token that still works', async () => {
    const socket = await connectAndAuth('p1');
    const init = vi.spyOn(session, 'init');
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

    expect(init).not.toHaveBeenCalled();
    expect(session.status).toBe('authed');
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

  // disconnect() nulls the handlers before closing, so #onClose never runs and
  // the end() in disconnect() is the only thing that stops the token. Left
  // answering, it would tell board.load() a board nothing is feeding is covered
  // and suppress the revalidating read for it.
  it('stops carrying the project it was covering', async () => {
    await connectAndAuth('p1');
    const carried = realtimeCoverage.tokenFor('p1');
    expect(realtimeCoverage.holds('p1', carried)).toBe(true);

    realtime.disconnect();

    expect(realtimeCoverage.tokenFor('p1')).toBeNull();
    expect(realtimeCoverage.holds('p1', carried)).toBe(false);
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
    // t=2999, and the second retry is due at t=3000 rather than t=2000: the wait
    // after the second close is two seconds, not another one. A fixed 1s backoff
    // satisfies every other timing here, and only this says otherwise.
    expect(FakeWebSocket.instances).toHaveLength(2);

    vi.advanceTimersByTime(1);
    expect(realtime.interrupted).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(3);
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

    // The socket says it is offline; the session says nothing yet. It stays 'authed'
    // for the round-trip rather than dropping to 'unknown', which is what keeps the
    // shell rendering the app instead of a spinner over it.
    expect(session.status).toBe('authed');
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

    socket.receive(
      realtimeEvent(
        'user_updated',
        { id: 'u-peer', name: 'Peer', avatar_url: '/api/avatars/k' },
        null
      )
    );
    expect(users.byId('u-peer')?.avatar_url).toBe('/api/avatars/k');
    expect(session.user?.name).toBe('Me');

    socket.receive(
      realtimeEvent('user_updated', { id: 'u1', name: 'Me Renamed', avatar_url: null }, null)
    );
    expect(session.user?.name).toBe('Me Renamed');
  });

  it('keeps the private account fields the public payload cannot carry', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'm@e.com', email_verified: true };

    socket.receive(
      realtimeEvent(
        'user_updated',
        { id: 'u1', name: 'Me Renamed', avatar_url: '/api/avatars/k' },
        null
      )
    );

    expect(session.user?.name).toBe('Me Renamed');
    expect(session.user?.avatar_url).toBe('/api/avatars/k');
    expect(session.user?.email).toBe('m@e.com');
    expect(session.user?.email_verified).toBe(true);
  });

  // This used to refetch /api/auth/me, purely because the address and its flag
  // were invisible in the public payload. account_updated carries them now, so
  // a rename must cost no round trip.
  it('does not re-read the account for a broadcast about self', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'm@e.com', email_verified: true };

    socket.receive(
      realtimeEvent('user_updated', { id: 'u1', name: 'Me Renamed', avatar_url: null }, null)
    );
    // A macrotask, not a microtask: openapi-fetch dispatches after an awaited
    // middleware tick, so a refetch would still be pending at this point.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.user?.email_verified).toBe(true);
  });

  it('leaves the session user and the account alone when the broadcast is someone else', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'm@e.com', email_verified: true };

    socket.receive(
      realtimeEvent('user_updated', { id: 'u-peer', name: 'Peer', avatar_url: null }, null)
    );

    // A macrotask before the negative assertion, for the reason the case above
    // gives: a request started by the handler is not on `fetchMock` yet in the
    // turn `receive()` returns in.
    await new Promise((resolve) => setTimeout(resolve, 0));

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

describe('account_updated dispatch', () => {
  const ME = {
    id: 'u1',
    name: 'Me',
    avatar_url: null,
    email: 'new@e.com',
    email_verified: true,
  };

  it('applies the address and its verification the public payload cannot carry', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'old@e.com', email_verified: false };

    socket.receive(realtimeEvent('account_updated', ME, null));
    // The event carries the whole account, so this is the assertion that it
    // costs no round trip — and it only holds once a request the handler started
    // would have reached `fetchMock`, which is a macrotask later.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.user?.email).toBe('new@e.com');
    expect(session.user?.email_verified).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The server sends this to one account's own sockets only, so this can fire
  // on a bug alone — and the cost of applying it is signing this tab in as
  // somebody else.
  it('ignores one addressed to another account', async () => {
    const socket = await connectAndAuth('p1');
    session.user = { ...session.user!, email: 'm@e.com', email_verified: false };

    socket.receive(
      realtimeEvent(
        'account_updated',
        { ...ME, id: 'u-peer', name: 'Peer', email: 'peer@e.com' },
        null
      )
    );

    expect(session.user?.id).toBe('u1');
    expect(session.user?.email).toBe('m@e.com');
    expect(session.user?.email_verified).toBe(false);
  });

  it('conjures no session user when there is none to update', async () => {
    const socket = await connectAndAuth('p1');
    session.user = null;

    socket.receive(realtimeEvent('account_updated', ME, null));

    expect(session.user).toBeNull();
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

    socket.receive(
      realtimeEvent(
        'project_updated',
        { id: 'p1', member_ids: [me.id], members: [{ user_id: me.id, role: 'viewer' }] },
        'p1'
      )
    );

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

  function changed(socket: FakeWebSocket, projectId: string, actorUserId?: string | null): void {
    socket.receive(
      realtimeEvent(
        'project_changed',
        actorUserId === undefined
          ? { id: projectId }
          : { id: projectId, actor_user_id: actorUserId },
        projectId
      )
    );
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

  // The pair above and below are what keep the `!== undefined` guard from being
  // read as dead code and deleted: the generated type says the field is required,
  // but an older pod really does omit it, and omitted and null mean opposite
  // things here.
  it('dots a change no session made, which is nobody’s own edit', async () => {
    seed();
    const socket = await connectAndAuth(null);

    changed(socket, 'p2', null);

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

    socket.receive(realtimeEvent('invitations_changed', { project_id: 'p1' }, 'p1'));

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

    socket.receive(realtimeEvent('invitations_changed', { project_id: 'p2' }, 'p2'));
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

describe('announcing a teammate’s board change', () => {
  const PROJECT = testUuid('p1');

  beforeEach(() => {
    users.users = [{ id: 'u2', name: 'Ana', avatar_url: null }];
    router.navigate(projectHref(PROJECT, 'Rulebook'), { replace: true });
  });

  // Only possible if record() ran before applyRealtime: the payload is an id,
  // so the title exists nowhere but the store this event is about to change.
  it('names a deleted card from the board as it stood before the event applied', async () => {
    board.tasks = [task('t1')];
    const socket = await connectAndAuth(PROJECT);

    vi.useFakeTimers();
    try {
      socket.receive(realtimeEvent('task_deleted', { id: 't1', actor_user_id: 'u2' }, PROJECT));
      expect(board.tasks).toEqual([]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(boardAnnouncer.message).toBe('Ana deleted "t1"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for a drag to finish, then announces what landed behind it', async () => {
    const socket = await connectAndAuth(PROJECT);
    board.dragging = true;

    vi.useFakeTimers();
    try {
      socket.receive(
        realtimeEvent('task_created', { ...task('t1'), actor_user_id: 'u2' }, PROJECT)
      );
      await vi.advanceTimersByTimeAsync(2000);
      expect(boardAnnouncer.message).toBe('');

      board.dragging = false;
      flushSync();
      await vi.advanceTimersByTimeAsync(1500);
      expect(boardAnnouncer.message).toBe('Ana added "t1"');
    } finally {
      vi.useRealTimers();
    }
  });

  // Every other board-event case in this file builds payloads with no actor, so
  // this is the invariant that keeps them all silent.
  it('announces nothing and tints nothing for an event that names no actor', async () => {
    const socket = await connectAndAuth(PROJECT);

    vi.useFakeTimers();
    try {
      socket.receive(realtimeEvent('task_created', task('t1'), PROJECT));
      await vi.advanceTimersByTimeAsync(1500);
      expect(boardAnnouncer.message).toBe('');
      expect(board.changedTaskIds.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
