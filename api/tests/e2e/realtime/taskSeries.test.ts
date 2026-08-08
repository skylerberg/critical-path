import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, projectSockets } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, type TestUser } from '../../setup/testContext';
import { newId, rankKey } from '../../helpers/fixtures';
import { waitFor } from '../projects/helpers';
import { RtClient, settle, type Envelope } from './helpers';

const SERIES_CREATED = 'series_created';
const SERIES_UPDATED = 'series_updated';
const SERIES_DELETED = 'series_deleted';

const SERIES_KEYS = [
  'id',
  'project_id',
  'column_id',
  'title',
  'description',
  'due_date',
  'rrule',
  'preset',
  'summary',
  'start_date',
  'timezone',
  'status',
  'next_occurrence_date',
  'last_occurrence_date',
  'missed_occurrence_count',
  'last_missed_date',
  'open_occurrence_count',
  'last_error',
  'ended_at',
  'created_by',
  'created_at',
  'updated_at',
  'label_ids',
  'assignee_ids',
  'checklist_items',
];

describe('Recurring series realtime events', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let ownerClient: RtClient;
  let editorClient: RtClient;
  let viewerClient: RtClient;
  let outsiderClient: RtClient;
  let roomlessOwnerClient: RtClient;
  const clients: RtClient[] = [];

  let projectId: string;
  let columnId: string;
  let otherProjectId: string;
  let seriesId: string;

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    clients.push(client);
    return client;
  }

  async function createSeries(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = newId();
    const res = await ctx.request(owner.token).post('/api/task-series', {
      id,
      project_id: projectId,
      column_id: columnId,
      title: 'Weekly review',
      start_date: '2026-02-02',
      timezone: 'UTC',
      ...('rrule' in overrides ? {} : { preset: 'daily' }),
      ...overrides,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return id;
  }

  function marks(): number[] {
    return clients.map((client) => client.events.length);
  }

  function since(from: number[]): Envelope[] {
    return clients.flatMap((client, index) => client.events.slice(from[index]));
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    owner = await ctx.createUser('series-rt-owner');
    editor = await ctx.createUser('series-rt-editor');
    viewer = await ctx.createUser('series-rt-viewer');
    outsider = await ctx.createUser('series-rt-outsider');

    projectId = newId();
    const created = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'series rt project' });
    expect(created.status).toBe(201);
    const board = (await created.json()) as { columns: { id: string }[] };
    columnId = board.columns[0].id;

    otherProjectId = newId();
    const other = await ctx
      .request(owner.token)
      .post('/api/projects', { id: otherProjectId, name: 'series rt other project' });
    expect(other.status).toBe(201);

    const shared = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [editor.id, viewer.id],
      roles: [
        { user_id: editor.id, role: 'editor' },
        { user_id: viewer.id, role: 'viewer' },
      ],
    });
    expect(shared.status).toBe(204);

    // A public board makes the outsider a genuine reader of this project, so the
    // room they subscribe to is one they could plausibly have open.
    const published = await ctx
      .request(owner.token)
      .patch(`/api/projects/${projectId}`, { is_public: true });
    expect(published.status).toBe(200);

    // Five tests below patch this series and assert on the events that follow.
    // Built before the clients connect, so its own series_created reaches none
    // of their buffers — the publish is a post-commit hook, so it can land
    // after a test has taken its mark — and a create that breaks fails this
    // hook once rather than leaving those five to patch an undefined id.
    seriesId = await createSeries({ title: 'Shared series' });

    ownerClient = await connect(owner.token);
    editorClient = await connect(editor.token);
    viewerClient = await connect(viewer.token);
    outsiderClient = await connect(outsider.token);
    for (const client of clients) {
      client.subscribe(projectId);
    }
    await waitFor(async () => projectSockets(projectId).length === 4);

    roomlessOwnerClient = await connect(owner.token);
    roomlessOwnerClient.subscribe(otherProjectId);
    await waitFor(async () => projectSockets(otherProjectId).length === 1);
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await ctx.cleanup();
  });

  it('publishes series_created carrying the whole row, to viewers as well as editors', async () => {
    const from = marks();

    const createdId = await createSeries({ title: 'Pay the invoices' });

    const event = await ownerClient.waitForEvent((e) => e.type === SERIES_CREATED, {
      from: from[0],
    });
    expect(Object.keys(event).sort()).toEqual(['data', 'project_id', 'type']);
    expect(event.project_id).toBe(projectId);
    expect(Object.keys(event.data).sort()).toEqual([...SERIES_KEYS].sort());
    expect(event.data.id).toBe(createdId);
    expect(event.data.title).toBe('Pay the invoices');
    expect(event.data.status).toBe('active');
    // The create response's extra field is not part of the row every other
    // reader sees.
    expect(event.data).not.toHaveProperty('dropped_image_count');

    await editorClient.waitForEvent((e) => e.type === SERIES_CREATED, { from: from[1] });
    await viewerClient.waitForEvent((e) => e.type === SERIES_CREATED, { from: from[2] });

    await settle();
    expect(outsiderClient.events.slice(from[3])).toEqual([]);
  });

  it('raises no project_changed dot for a schedule change', async () => {
    const from = marks();

    await createSeries({ title: 'no dot' });

    await ownerClient.waitForEvent((e) => e.type === SERIES_CREATED, { from: from[0] });
    await settle();
    expect(since(from).filter((event) => event.type === 'project_changed')).toEqual([]);
  });

  it('publishes series_updated on an edit', async () => {
    const from = marks();

    const res = await ctx
      .request(editor.token)
      .patch(`/api/task-series/${seriesId}`, { title: 'Pay the invoices twice' });
    expect(res.status).toBe(200);

    const event = await ownerClient.waitForEvent((e) => e.type === SERIES_UPDATED, {
      from: from[0],
    });
    expect(event.data.id).toBe(seriesId);
    expect(event.data.title).toBe('Pay the invoices twice');
    await viewerClient.waitForEvent((e) => e.type === SERIES_UPDATED, { from: from[2] });
  });

  it('publishes series_updated on pause and again on resume', async () => {
    const pausedFrom = marks();
    const paused = await ctx
      .request(owner.token)
      .patch(`/api/task-series/${seriesId}`, { status: 'paused' });
    expect(paused.status).toBe(200);
    const pausedEvent = await ownerClient.waitForEvent((e) => e.type === SERIES_UPDATED, {
      from: pausedFrom[0],
    });
    expect(pausedEvent.data.status).toBe('paused');

    const resumedFrom = marks();
    const resumed = await ctx
      .request(owner.token)
      .patch(`/api/task-series/${seriesId}`, { status: 'active' });
    expect(resumed.status).toBe(200);
    const resumedEvent = await ownerClient.waitForEvent((e) => e.type === SERIES_UPDATED, {
      from: resumedFrom[0],
    });
    expect(resumedEvent.data.status).toBe('active');
    expect(resumedEvent.data.next_occurrence_date).not.toBeNull();
  });

  it('publishes series_updated when a resume exhausts the rule and ends the series', async () => {
    const id = await createSeries({ rrule: 'FREQ=DAILY;UNTIL=20260210T000000Z' });
    const paused = await ctx.request(owner.token).patch(`/api/task-series/${id}`, {
      status: 'paused',
    });
    expect(paused.status).toBe(200);

    await settle();
    const from = marks();
    const resumed = await ctx.request(owner.token).patch(`/api/task-series/${id}`, {
      status: 'active',
    });
    expect(resumed.status).toBe(200);

    const event = await ownerClient.waitForEvent(
      (e) => e.type === SERIES_UPDATED && e.data.id === id,
      { from: from[0] }
    );
    expect(event.data.status).toBe('ended');
    expect(event.data.next_occurrence_date).toBeNull();
  });

  it('publishes series_updated when missed occurrences are dismissed', async () => {
    const from = marks();
    const res = await ctx
      .request(owner.token)
      .patch(`/api/task-series/${seriesId}`, { clear_missed: true });
    expect(res.status).toBe(200);

    const event = await ownerClient.waitForEvent(
      (e) => e.type === SERIES_UPDATED && e.data.id === seriesId,
      { from: from[0] }
    );
    expect(event.data.missed_occurrence_count).toBe(0);
    expect(event.data.last_missed_date).toBeNull();
  });

  it('publishes series_deleted carrying only the id', async () => {
    const id = await createSeries({ title: 'doomed' });
    const from = marks();

    const res = await ctx.request(owner.token).delete(`/api/task-series/${id}`);
    expect(res.status).toBe(204);

    const event = await ownerClient.waitForEvent((e) => e.type === SERIES_DELETED, {
      from: from[0],
    });
    expect(event.project_id).toBe(projectId);
    expect(event.data).toEqual({ id });
    await viewerClient.waitForEvent((e) => e.type === SERIES_DELETED, { from: from[2] });
  });

  it('publishes series_updated for a series whose destination column is deleted', async () => {
    const spareColumn = newId();
    const column = await ctx.request(owner.token).post('/api/columns', {
      id: spareColumn,
      project_id: projectId,
      name: 'spare',
      sort_key: rankKey(9000),
    });
    expect(column.status).toBe(201);
    const id = await createSeries({ title: 'orphaned', column_id: spareColumn });

    const from = marks();
    const deleted = await ctx.request(owner.token).delete(`/api/columns/${spareColumn}`);
    expect(deleted.status).toBe(204);

    const event = await ownerClient.waitForEvent(
      (e) => e.type === SERIES_UPDATED && e.data.id === id,
      { from: from[0] }
    );
    expect(event.data.column_id).toBeNull();
  });

  it('publishes nothing when a viewer is refused a mutation', async () => {
    await settle();
    const from = marks();

    const res = await ctx
      .request(viewer.token)
      .patch(`/api/task-series/${seriesId}`, { title: 'not allowed' });
    expect(res.status).toBe(403);

    await settle();
    expect(since(from)).toEqual([]);
  });

  it('publishes nothing when an outsider is refused a mutation', async () => {
    await settle();
    const from = marks();

    const res = await ctx
      .request(outsider.token)
      .patch(`/api/task-series/${seriesId}`, { title: 'not allowed either' });
    expect(res.status).toBe(404);

    await settle();
    expect(since(from)).toEqual([]);
  });

  it('publishes nothing when a create is rejected', async () => {
    await settle();
    const from = marks();

    const res = await ctx.request(owner.token).post('/api/task-series', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'bad rule',
      rrule: 'FREQ=HOURLY',
      start_date: '2026-02-02',
      timezone: 'UTC',
    });
    expect(res.status).toBe(422);

    await settle();
    expect(since(from)).toEqual([]);
  });

  it('reaches only the changed project’s room', async () => {
    const from = marks();

    await createSeries({ title: 'room scoped' });

    await ownerClient.waitForEvent((e) => e.type === SERIES_CREATED, { from: from[0] });
    await settle();
    expect(roomlessOwnerClient.events.slice(from[4])).toEqual([]);
  });
});
