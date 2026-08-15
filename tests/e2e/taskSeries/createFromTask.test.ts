import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, type RealtimeHandle } from '../../../src/services/realtime/index';
import { runSeriesSweep } from '../../../src/services/taskSeries/index';
import { MAX_SERIES_PER_PROJECT } from '../../../src/schemas/taskSeries';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

interface SeriesBody {
  id: string;
  project_id: string;
  column_id: string | null;
  title: string;
  description: unknown;
  due_date: string | null;
  preset: string | null;
  summary: string;
  start_date: string;
  next_occurrence_date: string | null;
  open_occurrence_count: number;
  label_ids: string[];
  assignee_ids: string[];
  checklist_items: { id: string; text: string }[];
  dropped_image_count: number;
}

interface TaskDetail {
  id: string;
  series: {
    id: string;
    summary: string;
    preset: string | null;
    start_date: string;
  } | null;
}

const TZ = 'UTC';

describe('Make a card repeat', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let server: ServerType;
  let realtime: RealtimeHandle;

  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;

  let projectId: string;
  let columnId: string;
  let labelId: string;

  async function createProject(user: TestUser, name: string): Promise<[string, string]> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { columns: { id: string }[] };
    return [id, body.columns[0].id];
  }

  async function createTask(overrides: Record<string, unknown> = {}): Promise<string> {
    const id = newId();
    const res = await ctx.request(owner.token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: columnId,
      title: 'Water the plants',
      ...overrides,
    });
    expect(res.status, await res.clone().text()).toBe(201);
    return id;
  }

  async function makeRepeat(
    taskId: string,
    overrides: Record<string, unknown> = {},
    token = owner.token
  ): Promise<Response> {
    return ctx.request(token).post(`/api/tasks/${taskId}/series`, {
      id: newId(),
      preset: 'weekly',
      start_date: await today(),
      timezone: TZ,
      ...overrides,
    });
  }

  async function repeated(
    taskId: string,
    overrides: Record<string, unknown> = {}
  ): Promise<SeriesBody> {
    const res = await makeRepeat(taskId, overrides);
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as SeriesBody;
  }

  async function detail(taskId: string, token = owner.token): Promise<TaskDetail> {
    const res = await ctx.request(token).get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as TaskDetail;
  }

  // Read from the server rather than the test's own clock: the handler anchors
  // the first occurrence on its own "today", and a test that disagrees about the
  // day fails only when it runs near midnight.
  async function today(): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select to_char((now() at time zone ${TZ})::date, 'YYYY-MM-DD') as today
    `.execute(db);
    return rows[0].today;
  }

  async function noonToday(): Promise<Date> {
    const { rows } = await sql<{ at: Date }>`
      select ((${await today()}::date + interval '12 hours') at time zone ${TZ}) as at
    `.execute(db);
    return rows[0].at;
  }

  async function cardsOf(seriesId: string): Promise<{ id: string; occurrence: string | null }[]> {
    return db
      .selectFrom('task')
      .select([
        'task.id',
        sql<string | null>`to_char(task.series_occurrence_date, 'YYYY-MM-DD')`.as('occurrence'),
      ])
      .where('task.series_id', '=', seriesId)
      .orderBy('task.series_occurrence_date')
      .execute();
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve());
    });
    realtime = attachRealtime(server);

    owner = await ctx.createUser('cft-owner');
    editor = await ctx.createUser('cft-editor');
    viewer = await ctx.createUser('cft-viewer');
    outsider = await ctx.createUser('cft-outsider');

    [projectId, columnId] = await createProject(owner, 'repeat project');

    const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [editor.id, viewer.id],
      roles: [
        { user_id: editor.id, role: 'editor' },
        { user_id: viewer.id, role: 'viewer' },
      ],
    });
    expect(members.status).toBe(204);

    labelId = newId();
    const label = await ctx.request(owner.token).post('/api/labels', {
      id: labelId,
      project_id: projectId,
      name: 'chores',
      color: '#22c55e',
    });
    expect(label.status, await label.clone().text()).toBe(201);
  });

  afterAll(async () => {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  it('adopts the card as the first occurrence', async () => {
    const taskId = await createTask();
    const series = await repeated(taskId);

    expect(series.next_occurrence_date).toBe(await today());
    expect(series.open_occurrence_count).toBe(1);

    const cards = await cardsOf(series.id);
    expect(cards).toEqual([{ id: taskId, occurrence: series.next_occurrence_date }]);

    const card = await detail(taskId);
    // Everything the card's own recurrence menu is built from, so it never has
    // to read the project's series list to render itself.
    expect(card.series).toEqual({
      id: series.id,
      summary: series.summary,
      preset: 'weekly',
      start_date: series.start_date,
    });
  });

  // The card's menu offers the curated presets, so a rule outside them has to
  // arrive as a null preset rather than as the nearest match — otherwise picking
  // "save" on a card would quietly rewrite a rule nobody touched.
  it('reports a rule the curated set cannot name as no preset', async () => {
    const taskId = await createTask();
    const series = await repeated(taskId, {
      preset: undefined,
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    });

    const card = await detail(taskId);
    expect(card.series).toEqual({
      id: series.id,
      summary: series.summary,
      preset: null,
      start_date: series.start_date,
    });
  });

  it('copies the card as the template', async () => {
    const taskId = await createTask({
      title: 'Water the plants',
      due_date: '2026-09-01',
      label_ids: [labelId],
      assignee_ids: [editor.id],
    });
    const items = await ctx
      .request(owner.token)
      .post('/api/checklist-items', { id: newId(), task_id: taskId, text: 'Ferns' });
    expect(items.status, await items.clone().text()).toBe(201);

    const series = await repeated(taskId);

    expect(series).toMatchObject({
      title: 'Water the plants',
      project_id: projectId,
      column_id: columnId,
      due_date: '2026-09-01',
      label_ids: [labelId],
      assignee_ids: [editor.id],
      preset: 'weekly',
      dropped_image_count: 0,
    });
    expect(series.checklist_items.map((item) => item.text)).toEqual(['Ferns']);
  });

  it('does not create a second copy on the day it was adopted for', async () => {
    const taskId = await createTask({ title: 'Daily standup' });
    const series = await repeated(taskId, { preset: 'daily' });
    expect(series.next_occurrence_date).toBe(await today());

    await runSeriesSweep({ now: await noonToday() });

    const cards = await cardsOf(series.id);
    expect(cards.map((card) => card.id)).toEqual([taskId]);
  });

  it('leaves the card behind when the series is deleted', async () => {
    const taskId = await createTask();
    const series = await repeated(taskId);

    const removed = await ctx.request(owner.token).delete(`/api/task-series/${series.id}`);
    expect(removed.status).toBe(204);

    const card = await detail(taskId);
    expect(card.id).toBe(taskId);
    expect(card.series).toBeNull();
  });

  it('refuses a card that already repeats', async () => {
    const taskId = await createTask();
    await repeated(taskId);

    const again = await makeRepeat(taskId);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({
      error: 'This card already belongs to a recurring series',
    });
  });

  it('refuses an archived card', async () => {
    const taskId = await createTask();
    const archived = await ctx.request(owner.token).post(`/api/tasks/${taskId}/archive`, {});
    expect(archived.status, await archived.clone().text()).toBe(200);

    const res = await makeRepeat(taskId);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'An archived card cannot start repeating' });
  });

  it('refuses a project already at the series limit', async () => {
    const [fullProject, fullColumn] = await createProject(owner, 'full project');
    // Seeded straight into the table rather than posted one at a time. The cap this
    // test is about is a `COUNT(*)` over `task_series` for the project, so the rows
    // only have to exist; and POST /api/task-series takes `forUpdate()` on the
    // project row to serialise that count, which makes 50 creates 50 serial round
    // trips whatever the client does. That setup took ~25s of a 30s timeout and
    // timed out for real the moment the machine was busy.
    await db
      .insertInto('task_series')
      .values(
        Array.from({ length: MAX_SERIES_PER_PROJECT }, (_, i) => ({
          id: newId(),
          project_id: fullProject,
          column_id: fullColumn,
          title: `Series ${String(i)}`,
          rrule: 'FREQ=WEEKLY',
          start_date: '2026-01-01',
          timezone: TZ,
        }))
      )
      .execute();

    const taskId = newId();
    const task = await ctx.request(owner.token).post('/api/tasks', {
      id: taskId,
      project_id: fullProject,
      column_id: fullColumn,
      title: 'One too many',
    });
    expect(task.status).toBe(201);

    const res = await makeRepeat(taskId);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: `Project already has the maximum of ${String(MAX_SERIES_PER_PROJECT)} recurring series`,
    });
  });

  it('rejects a rule the curated set cannot express', async () => {
    const taskId = await createTask();
    const res = await makeRepeat(taskId, { preset: undefined, rrule: 'FREQ=HOURLY' });
    expect(res.status).toBe(422);
    expect(await makeRepeat(taskId, { preset: 'weekly', rrule: 'FREQ=WEEKLY' })).toMatchObject({
      status: 422,
    });
  });

  it('lets an editor start a repeat but not a viewer or an outsider', async () => {
    const forEditor = await createTask();
    expect((await makeRepeat(forEditor, {}, editor.token)).status).toBe(201);

    const forViewer = await createTask();
    expect((await makeRepeat(forViewer, {}, viewer.token)).status).toBe(403);

    const forOutsider = await createTask();
    expect((await makeRepeat(forOutsider, {}, outsider.token)).status).toBe(404);
  });

  it('404s for a task that does not exist', async () => {
    const res = await makeRepeat(newId());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Task not found' });
  });
});
