import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, type RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { RtClient, settle } from '../realtime/helpers';
import { MAX_SERIES_PER_PROJECT } from '../../../src/schemas/taskSeries';

interface SeriesBody {
  id: string;
  project_id: string;
  column_id: string | null;
  title: string;
  description: unknown;
  due_date: string | null;
  rrule: string;
  preset: string | null;
  summary: string;
  start_date: string;
  timezone: string;
  status: string;
  next_occurrence_date: string | null;
  last_occurrence_date: string | null;
  missed_occurrence_count: number;
  last_missed_date: string | null;
  open_occurrence_count: number;
  last_error: string | null;
  ended_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  assignee_ids: string[];
  checklist_items: { id: string; text: string; sort_key: string }[];
}

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

const TZ = 'Europe/Berlin';

describe('Recurring series API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;

  let projectId: string;
  let columnId: string;
  let otherProjectId: string;
  let otherColumnId: string;

  async function createProject(user: TestUser, name: string): Promise<[string, string]> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { columns: { id: string }[] };
    return [id, body.columns[0].id];
  }

  function seriesBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'Weekly review',
      preset: 'weekly',
      start_date: '2026-02-02',
      timezone: TZ,
      ...overrides,
    };
  }

  async function create(
    overrides: Record<string, unknown> = {},
    token = owner.token
  ): Promise<SeriesBody & { dropped_image_count: number }> {
    const res = await ctx.request(token).post('/api/task-series', seriesBody(overrides));
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as SeriesBody & { dropped_image_count: number };
  }

  async function list(token = owner.token, id = projectId): Promise<SeriesBody[]> {
    const res = await ctx.request(token).get(`/api/task-series?project_id=${id}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { series: SeriesBody[] }).series;
  }

  async function expectRejected(
    overrides: Record<string, unknown>,
    status = 422
  ): Promise<Response> {
    const res = await ctx.request(owner.token).post('/api/task-series', seriesBody(overrides));
    expect(res.status, JSON.stringify(overrides)).toBe(status);
    return res;
  }

  // `at` is the instant the request that produced a schedule ran at, taken from
  // the row's own created_at/updated_at. Both that column and the handler's
  // "today" come from now(), which is the transaction's timestamp, so the day
  // this reports is the day the server scheduled from — not the day it happens
  // to be by the time the assertion runs.
  async function todayInBerlin(at: Date): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select to_char((${at}::timestamptz at time zone ${TZ})::date, 'YYYY-MM-DD') as today
    `.execute(db);
    return rows[0].today;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    owner = await ctx.createUser('ts-owner');
    editor = await ctx.createUser('ts-editor');
    viewer = await ctx.createUser('ts-viewer');
    outsider = await ctx.createUser('ts-outsider');

    [projectId, columnId] = await createProject(owner, 'series project');
    [otherProjectId, otherColumnId] = await createProject(outsider, 'other project');

    const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [editor.id, viewer.id],
      roles: [
        { user_id: editor.id, role: 'editor' },
        { user_id: viewer.id, role: 'viewer' },
      ],
    });
    expect(members.status).toBe(204);
  });

  afterAll(async () => {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  describe('authorization', () => {
    it('hides the project from an outsider on every verb', async () => {
      const existing = await create();

      const get = await ctx.request(outsider.token).get(`/api/task-series?project_id=${projectId}`);
      expect(get.status).toBe(404);
      expect(await get.json()).toEqual({ error: 'Project not found' });

      const post = await ctx.request(outsider.token).post('/api/task-series', seriesBody());
      expect(post.status).toBe(404);

      const patch = await ctx
        .request(outsider.token)
        .patch(`/api/task-series/${existing.id}`, { title: 'nope' });
      expect(patch.status).toBe(404);
      expect(await patch.json()).toEqual({ error: 'Series not found' });

      const del = await ctx.request(outsider.token).delete(`/api/task-series/${existing.id}`);
      expect(del.status).toBe(404);

      // A series that does not exist is indistinguishable from one that does.
      const missing = await ctx
        .request(outsider.token)
        .patch(`/api/task-series/${newId()}`, { title: 'nope' });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({ error: 'Series not found' });
    });

    it('lets a viewer read but not write', async () => {
      const existing = await create();

      expect((await list(viewer.token)).some((row) => row.id === existing.id)).toBe(true);

      const post = await ctx.request(viewer.token).post('/api/task-series', seriesBody());
      expect(post.status).toBe(403);

      const patch = await ctx
        .request(viewer.token)
        .patch(`/api/task-series/${existing.id}`, { title: 'nope' });
      expect(patch.status).toBe(403);

      const del = await ctx.request(viewer.token).delete(`/api/task-series/${existing.id}`);
      expect(del.status).toBe(403);
    });

    it('lets a member editor create and change a series', async () => {
      const created = await create({}, editor.token);
      expect(created.created_by).toBe(editor.id);

      const patch = await ctx
        .request(editor.token)
        .patch(`/api/task-series/${created.id}`, { title: 'renamed' });
      expect(patch.status).toBe(200);
      expect(((await patch.json()) as SeriesBody).title).toBe('renamed');
    });

    it('requires authentication', async () => {
      const res = await ctx.request().get(`/api/task-series?project_id=${projectId}`);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/task-series', () => {
    it('returns exactly the documented response shape', async () => {
      const created = await create();
      expect(Object.keys(created).sort()).toEqual([...SERIES_KEYS, 'dropped_image_count'].sort());
    });

    it('stores the canonical rule for a preset and reports it back', async () => {
      const created = await create({ preset: 'weekly', start_date: '2026-02-02' });
      expect(created.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
      expect(created.preset).toBe('weekly');
      expect(created.summary).toBe('Every Monday');
    });

    it('clamps a month-end preset rather than skipping short months', async () => {
      const created = await create({ preset: 'monthly_date', start_date: '2026-01-31' });
      expect(created.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=31,-1;BYSETPOS=1');
      expect(created.summary).toBe('Monthly on the 31st, or the last day of shorter months');
    });

    it('accepts a rule outside the curated set and still renders it readably', async () => {
      const created = await create({
        preset: undefined,
        rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
        start_date: '2026-02-02',
      });
      expect(created.preset).toBeNull();
      expect(created.summary.length).toBeGreaterThan(0);
      expect(created.summary).toContain('every 2 weeks');
    });

    it('strips image nodes from the template description and says how many', async () => {
      const created = await create({
        description: {
          type: 'doc',
          content: [
            { type: 'image', attrs: { src: `/api/images/${newId()}` } },
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'kept' },
                { type: 'image', attrs: { src: `/api/images/${newId()}` } },
              ],
            },
          ],
        },
      });
      expect(created.dropped_image_count).toBe(2);
      expect(JSON.stringify(created.description)).not.toContain('image');
      expect(JSON.stringify(created.description)).toContain('kept');
    });

    it('treats the due date as an optional template field, defaulting to none', async () => {
      expect((await create()).due_date).toBeNull();

      const dated = await create({ due_date: '2026-03-04' });
      expect(dated.due_date).toBe('2026-03-04');

      const cleared = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${dated.id}`, { due_date: null });
      expect(cleared.status).toBe(200);
      expect(((await cleared.json()) as SeriesBody).due_date).toBeNull();
    });

    it('carries labels, assignees and checklist items', async () => {
      const labelId = newId();
      const label = await ctx
        .request(owner.token)
        .post('/api/labels', { id: labelId, project_id: projectId, name: 'ops', color: '#ff0000' });
      expect(label.status).toBe(201);

      const created = await create({
        label_ids: [labelId],
        assignee_ids: [editor.id],
        checklist_items: [{ text: 'first' }, { text: 'second' }],
      });
      expect(created.label_ids).toEqual([labelId]);
      expect(created.assignee_ids).toEqual([editor.id]);
      expect(created.checklist_items.map((item) => item.text)).toEqual(['first', 'second']);
    });

    it('returns 409 for a duplicate id', async () => {
      const id = newId();
      await create({ id });
      const again = await ctx.request(owner.token).post('/api/task-series', seriesBody({ id }));
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: 'Series id already in use' });
    });

    it('refuses cross-project and unusable input with 422', async () => {
      const otherLabelId = newId();
      const otherLabel = await ctx.request(outsider.token).post('/api/labels', {
        id: otherLabelId,
        project_id: otherProjectId,
        name: 'theirs',
        color: '#00ff00',
      });
      expect(otherLabel.status).toBe(201);

      await expectRejected({ column_id: otherColumnId });
      await expectRejected({ label_ids: [otherLabelId] });
      await expectRejected({ assignee_ids: [outsider.id] });
      await expectRejected({ timezone: 'Mars/Olympus' });
      await expectRejected({ start_date: '2026-02-02T10:00:00Z' });
      await expectRejected({ due_date: '2026-02-30' });
      await expectRejected({
        checklist_items: Array.from({ length: 101 }, (_, index) => ({
          text: `item ${String(index)}`,
          position: index * 1000,
        })),
      });
      await expectRejected({ preset: 'weekly', rrule: 'FREQ=DAILY' });
      await expectRejected({ preset: undefined });
      await expectRejected({ title: '   ' });
    });

    it('refuses a rule the sweep could not safely evaluate', async () => {
      for (const rrule of [
        'FREQ=SECONDLY',
        'FREQ=MINUTELY',
        'FREQ=HOURLY',
        'FREQ=DAILY;INTERVAL=400',
        'FREQ=DAILY;COUNT=100000',
        'FREQ=DAILY;UNTIL=99990101T000000Z',
        'RRULE:FREQ=DAILY',
        'FREQ=DAILY;DTSTART=20260101T000000Z',
        'FREQ=DAILY;TZID=Europe/Berlin',
        'FREQ=DAILY;RDATE=20260101T000000Z',
        'FREQ=DAILY;EXDATE=20260101T000000Z',
        'FREQ=DAILY;EXRULE=FREQ=WEEKLY',
        'FREQ=DAILY;BYHOUR=0,1,2',
        'FREQ=DAILY;BYMINUTE=0,30',
        'FREQ=DAILY;BYSECOND=0,30',
        'total nonsense',
        'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30',
      ]) {
        await expectRejected({ preset: undefined, rrule });
      }
    });

    it('caps how many series one project may hold', async () => {
      const [cappedProject, cappedColumn] = await createProject(owner, 'capped');
      for (let i = 0; i < MAX_SERIES_PER_PROJECT; i++) {
        const res = await ctx.request(owner.token).post('/api/task-series', {
          ...seriesBody(),
          project_id: cappedProject,
          column_id: cappedColumn,
        });
        expect(res.status).toBe(201);
      }
      const overflow = await ctx.request(owner.token).post('/api/task-series', {
        ...seriesBody(),
        project_id: cappedProject,
        column_id: cappedColumn,
      });
      expect(overflow.status).toBe(422);
      expect(((await overflow.json()) as { error: string }).error).toContain(
        String(MAX_SERIES_PER_PROJECT)
      );
    });
  });

  describe('forward-only scheduling', () => {
    it('never backfills a start date in the past', async () => {
      const created = await create({ preset: 'daily', start_date: '2020-01-01' });
      expect(created.next_occurrence_date).toBe(await todayInBerlin(new Date(created.created_at)));
      expect(created.missed_occurrence_count).toBe(0);
      expect(created.last_occurrence_date).toBeNull();
    });

    it('never moves the next occurrence earlier than today on a rule change', async () => {
      const created = await create({ preset: 'weekly', start_date: '2020-01-06' });
      const res = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { preset: 'daily', start_date: '2019-05-05' });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as SeriesBody;
      expect(updated.next_occurrence_date).toBe(await todayInBerlin(new Date(updated.updated_at)));
      expect(updated.rrule).toBe('FREQ=DAILY');
    });
  });

  describe('PATCH /api/task-series/:id', () => {
    it('replaces a collection that is present and leaves an absent one alone', async () => {
      const labelId = newId();
      await ctx
        .request(owner.token)
        .post('/api/labels', { id: labelId, project_id: projectId, name: 'p', color: '#123456' });

      const created = await create({
        label_ids: [labelId],
        assignee_ids: [editor.id],
        checklist_items: [{ text: 'one' }],
      });

      const res = await ctx.request(owner.token).patch(`/api/task-series/${created.id}`, {
        checklist_items: [{ text: 'two' }, { text: 'three' }],
      });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as SeriesBody;
      expect(updated.checklist_items.map((item) => item.text)).toEqual(['two', 'three']);
      expect(updated.label_ids).toEqual([labelId]);
      expect(updated.assignee_ids).toEqual([editor.id]);

      const cleared = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { label_ids: [], assignee_ids: [] });
      expect(cleared.status).toBe(200);
      const clearedBody = (await cleared.json()) as SeriesBody;
      expect(clearedBody.label_ids).toEqual([]);
      expect(clearedBody.assignee_ids).toEqual([]);
      expect(clearedBody.checklist_items).toHaveLength(2);
    });

    it('touches no card the series already created', async () => {
      const created = await create({ preset: 'daily' });
      const taskId = newId();
      await db
        .insertInto('task')
        .values({
          id: taskId,
          project_id: projectId,
          column_id: columnId,
          title: 'materialized',
          sort_key: rankKey(1000),
          series_id: created.id,
          series_occurrence_date: '2026-02-02',
        })
        .execute();
      const before = await db
        .selectFrom('task')
        .select(['title', 'updated_at'])
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow();

      const res = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { title: 'new template title' });
      expect(res.status).toBe(200);

      const after = await db
        .selectFrom('task')
        .select(['title', 'updated_at'])
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow();
      expect(after.title).toBe(before.title);
      expect(after.updated_at.toISOString()).toBe(before.updated_at.toISOString());
    });

    it('pauses and resumes, rescheduling from today rather than from the backlog', async () => {
      const created = await create({ preset: 'daily' });

      const paused = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { status: 'paused' });
      expect(paused.status).toBe(200);
      expect(((await paused.json()) as SeriesBody).status).toBe('paused');
      const pausedRow = await db
        .selectFrom('task_series')
        .select('next_occurrence_at')
        .where('id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(pausedRow.next_occurrence_at).toBeNull();

      await db
        .updateTable('task_series')
        .set({ next_occurrence_date: '2020-01-01' })
        .where('id', '=', created.id)
        .execute();

      const resumed = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { status: 'active' });
      expect(resumed.status).toBe(200);
      const body = (await resumed.json()) as SeriesBody;
      expect(body.status).toBe('active');
      expect(body.next_occurrence_date).toBe(await todayInBerlin(new Date(body.updated_at)));
      expect(body.missed_occurrence_count).toBe(0);
    });

    it('clears the missed counter on request', async () => {
      const created = await create();
      await db
        .updateTable('task_series')
        .set({ missed_occurrence_count: 7, last_missed_date: '2026-01-01' })
        .where('id', '=', created.id)
        .execute();

      const res = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { clear_missed: true });
      expect(res.status).toBe(200);
      const body = (await res.json()) as SeriesBody;
      expect(body.missed_occurrence_count).toBe(0);
      expect(body.last_missed_date).toBeNull();
    });

    it('refuses to end a series through status', async () => {
      const created = await create();
      const res = await ctx
        .request(owner.token)
        .patch(`/api/task-series/${created.id}`, { status: 'ended' });
      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/task-series/:id', () => {
    it('leaves cards it already created alive and unlinked', async () => {
      const created = await create({ preset: 'daily' });
      const taskId = newId();
      await db
        .insertInto('task')
        .values({
          id: taskId,
          project_id: projectId,
          column_id: columnId,
          title: 'already created',
          sort_key: rankKey(1000),
          series_id: created.id,
          series_occurrence_date: '2026-02-03',
        })
        .execute();

      const res = await ctx.request(owner.token).delete(`/api/task-series/${created.id}`);
      expect(res.status).toBe(204);

      const task = await db
        .selectFrom('task')
        .select(['id', 'title', 'series_id'])
        .where('id', '=', taskId)
        .executeTakeFirstOrThrow();
      expect(task.title).toBe('already created');
      expect(task.series_id).toBeNull();

      expect((await list()).some((row) => row.id === created.id)).toBe(false);
    });
  });

  describe('cascades', () => {
    it('drops a series with its project', async () => {
      const [tempProject, tempColumn] = await createProject(owner, 'temp');
      const created = await create({ project_id: tempProject, column_id: tempColumn });
      const res = await ctx.request(owner.token).delete(`/api/projects/${tempProject}`);
      expect(res.status).toBe(204);
      const rows = await db
        .selectFrom('task_series')
        .select('id')
        .where('id', '=', created.id)
        .execute();
      expect(rows).toHaveLength(0);
    });

    it('drops only the join row when a label goes', async () => {
      const labelId = newId();
      await ctx.request(owner.token).post('/api/labels', {
        id: labelId,
        project_id: projectId,
        name: 'gone',
        color: '#0000ff',
      });
      const created = await create({ label_ids: [labelId] });

      const res = await ctx.request(owner.token).delete(`/api/labels/${labelId}`);
      expect(res.status).toBe(204);

      const [after] = (await list()).filter((row) => row.id === created.id);
      expect(after).toBeDefined();
      expect(after.label_ids).toEqual([]);
    });

    it('nulls the destination column when it is deleted instead of destroying the series', async () => {
      const [tempProject, tempColumn] = await createProject(owner, 'column cascade');
      const created = await create({ project_id: tempProject, column_id: tempColumn });

      const res = await ctx.request(owner.token).delete(`/api/columns/${tempColumn}`);
      expect(res.status).toBe(204);

      const [after] = await list(owner.token, tempProject);
      expect(after.id).toBe(created.id);
      expect(after.column_id).toBeNull();
    });

    it('keeps a series whose creating account is deleted, unowned', async () => {
      const author = await ctx.createUser('ts-author');
      const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [editor.id, viewer.id, author.id],
        roles: [
          { user_id: editor.id, role: 'editor' },
          { user_id: viewer.id, role: 'viewer' },
          { user_id: author.id, role: 'editor' },
        ],
      });
      expect(members.status).toBe(204);

      const created = await create({}, author.token);
      expect(created.created_by).toBe(author.id);
      await db.deleteFrom('app_user').where('id', '=', author.id).execute();

      const [after] = (await list()).filter((row) => row.id === created.id);
      expect(after).toBeDefined();
      expect(after.created_by).toBeNull();
      expect(after.status).toBe('active');

      const restore = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [editor.id, viewer.id],
        roles: [
          { user_id: editor.id, role: 'editor' },
          { user_id: viewer.id, role: 'viewer' },
        ],
      });
      expect(restore.status).toBe(204);
    });
  });

  describe('realtime surface, but no webhook surface, for series configuration', () => {
    it('pushes each change to sockets and none of them to registrations', async () => {
      const webhookId = newId();
      const registered = await ctx.request(owner.token).post('/api/webhooks', {
        id: webhookId,
        project_id: projectId,
        url: 'https://example.com/series-hook',
      });
      expect(registered.status).toBe(201);
      await db.deleteFrom('webhook_delivery').where('webhook_id', '=', webhookId).execute();

      const client = await RtClient.connect(port, owner.token);
      client.subscribe(projectId);
      await settle();
      const from = client.events.length;

      const created = await create();
      await ctx.request(owner.token).patch(`/api/task-series/${created.id}`, { title: 'edited' });
      await ctx.request(owner.token).delete(`/api/task-series/${created.id}`);
      await settle();

      expect(client.events.slice(from).map((event) => event.type)).toEqual([
        'series_created',
        'series_updated',
        'series_deleted',
      ]);
      const deliveries = await db
        .selectFrom('webhook_delivery')
        .select('event_type')
        .where('webhook_id', '=', webhookId)
        .execute();
      expect(deliveries).toEqual([]);

      client.close();
      await ctx.request(owner.token).delete(`/api/webhooks/${webhookId}`);
    });
  });
});
