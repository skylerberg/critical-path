import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { sql } from 'kysely';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, type RealtimeHandle } from '../../../src/services/realtime/index';
import {
  MAX_HANDLER_TIMEOUT_MS,
  registeredJobKinds,
  runDueJobs,
  runJobMaintenance,
  unregisterJobHandler,
} from '../../../src/services/jobs/index';
import {
  MAX_CATCHUP_SCAN,
  MAX_CONSECUTIVE_FAILURES,
  SWEEP_BATCH,
  SWEEP_INTERVAL_SECONDS,
  SWEEP_TIMEOUT_MS,
  TASK_SERIES_JOB_KIND,
  addDays,
  registerTaskSeriesJob,
  runSeriesSweep,
} from '../../../src/services/taskSeries/index';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { RtClient, settle } from '../realtime/helpers';

const BOARD_TASK_KEYS = [
  'id',
  'actor_user_id',
  'column_id',
  'title',
  'description',
  'sort_key',
  'due_date',
  'created_at',
  'updated_at',
  'column_since',
  'label_ids',
  'assignee_ids',
  'blocker_ids',
  'open_cross_project_blocker_count',
  'cover_image_url',
  'comment_count',
  'attachment_count',
  'checklist_item_count',
  'checklist_done_count',
];

interface SeriesBody {
  id: string;
  created_by: string | null;
  column_id: string | null;
  label_ids: string[];
  assignee_ids: string[];
  checklist_items: { text: string }[];
  status: string;
  next_occurrence_date: string | null;
  last_occurrence_date: string | null;
  missed_occurrence_count: number;
  last_missed_date: string | null;
  open_occurrence_count: number;
  last_error: string | null;
  ended_at: string | null;
  created_at: string;
}

interface TaskRow {
  id: string;
  title: string;
  column_id: string;
  sort_key: string;
  due_date: string | null;
  series_occurrence_date: string | null;
}

describe('Recurring series materialisation', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  let projectId: string;
  let columnId: string;
  // Only ever a start date, never an expected value: a start date has to be on
  // or before today and every case that cares leaves days of slack, so one read
  // for the file is safe where a read to compare against would not be.
  let seriesStart: string;

  async function createProject(name: string): Promise<[string, string]> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { columns: { id: string }[] };
    return [id, body.columns[0].id];
  }

  async function todayIn(timezone: string, at?: Date): Promise<string> {
    const { rows } = await sql<{ today: string }>`
      select to_char((coalesce(${at ?? null}::timestamptz, now()) at time zone ${timezone})::date, 'YYYY-MM-DD')
        as today
    `.execute(db);
    return rows[0].today;
  }

  // Noon is as far from midnight, and from every DST transition, as an instant
  // gets, so this lands unambiguously on `date` in `timezone`. Pinning a sweep
  // to it is what stops the calendar day rolling over between the request that
  // produced a date and the assertion made against it.
  async function noonIn(date: string, timezone: string): Promise<Date> {
    const { rows } = await sql<{ at: Date }>`
      select ((${date}::date + interval '12 hours') at time zone ${timezone}) as at
    `.execute(db);
    return rows[0].at;
  }

  async function createSeries(overrides: Record<string, unknown> = {}): Promise<SeriesBody> {
    const body = {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'Weekly review',
      preset: 'daily',
      start_date: seriesStart,
      timezone: 'UTC',
      ...overrides,
    };
    const res = await ctx.request(owner.token).post('/api/task-series', body);
    expect(res.status, await res.clone().text()).toBe(201);
    return (await res.json()) as SeriesBody;
  }

  // A series starting in the past is scheduled on the day the server read inside
  // that one request, so the 201 body is where a test takes "today" from.
  function todayOf(series: SeriesBody): string {
    expect(series.next_occurrence_date).not.toBeNull();
    return series.next_occurrence_date as string;
  }

  // A minute before the instant the sweep is pinned to, so one run claims the
  // series once: the schedule the run then writes is either further back than
  // this — and so behind the keyset cursor — or past `at` and out of the batch.
  async function forceDue(seriesId: string, occurrenceDate: string, at: Date): Promise<void> {
    await db
      .updateTable('task_series')
      .set({
        next_occurrence_date: occurrenceDate,
        next_occurrence_at: sql<Date>`${at}::timestamptz - interval '1 minute'`,
      })
      .where('id', '=', seriesId)
      .execute();
  }

  async function tasksOf(seriesId: string): Promise<TaskRow[]> {
    const rows = await db
      .selectFrom('task')
      .select([
        'task.id',
        'task.title',
        'task.column_id',
        'task.sort_key',
        sql<string | null>`to_char(task.due_date, 'YYYY-MM-DD')`.as('due_date'),
        sql<string | null>`to_char(task.series_occurrence_date, 'YYYY-MM-DD')`.as(
          'series_occurrence_date'
        ),
      ])
      .where('task.series_id', '=', seriesId)
      .orderBy('task.series_occurrence_date')
      .execute();
    return rows;
  }

  async function seriesOf(project: string): Promise<SeriesBody[]> {
    const res = await ctx.request(owner.token).get(`/api/task-series?project_id=${project}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { series: SeriesBody[] }).series;
  }

  async function seriesRow(seriesId: string, project = projectId): Promise<SeriesBody> {
    const found = (await seriesOf(project)).find((row) => row.id === seriesId);
    expect(found).toBeDefined();
    return found as SeriesBody;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    owner = await ctx.createUser('mat-owner');
    member = await ctx.createUser('mat-member');
    outsider = await ctx.createUser('mat-outsider');
    seriesStart = await todayIn('UTC');

    [projectId, columnId] = await createProject('materialise project');
    const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [member.id],
      roles: [{ user_id: member.id, role: 'editor' }],
    });
    expect(members.status).toBe(204);
  });

  // Every sweep is global, so a series left behind by one case would be a
  // candidate in the next one's batch.
  beforeEach(async () => {
    await db.deleteFrom('task_series').execute();
    await db.deleteFrom('task').where('project_id', 'in', projectIds).execute();
    await db.deleteFrom('job').execute();
  });

  // The handler registry and the job table both outlive this file: a kind left
  // registered gets a schedule seeded by whichever file runs next.
  afterEach(async () => {
    for (const kind of registeredJobKinds()) unregisterJobHandler(kind);
    await db.deleteFrom('job').execute();
  });

  afterAll(async () => {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  it('materialises one ordinary card carrying the whole template', async () => {
    const labelId = newId();
    await ctx
      .request(owner.token)
      .post('/api/labels', { id: labelId, project_id: projectId, name: 'ops', color: '#ff0000' });

    const existing = newId();
    const tailKey = rankKey(4000);
    await db
      .insertInto('task')
      .values({
        id: existing,
        project_id: projectId,
        column_id: columnId,
        title: 'already here',
        sort_key: tailKey,
      })
      .execute();

    const series = await createSeries({
      title: 'Monthly invoice',
      description: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
      },
      label_ids: [labelId],
      assignee_ids: [member.id],
      checklist_items: [{ text: 'first' }, { text: 'second' }],
    });
    const today = todayOf(series);

    expect(await runSeriesSweep({ now: await noonIn(today, 'UTC') })).toBe(1);

    const cards = await tasksOf(series.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: 'Monthly invoice',
      column_id: columnId,
      due_date: null,
      series_occurrence_date: today,
    });
    // Materialised after the tail, so it ranks above everything already there.
    expect(cards[0].sort_key > tailKey).toBe(true);

    const detail = await ctx.request(owner.token).get(`/api/tasks/${cards[0].id}`);
    expect(detail.status).toBe(200);
    const body = (await detail.json()) as {
      description: unknown;
      label_ids: string[];
      assignee_ids: string[];
      checklist_items: { text: string }[];
    };
    expect(JSON.stringify(body.description)).toContain('body');
    expect(body.label_ids).toEqual([labelId]);
    expect(body.assignee_ids).toEqual([member.id]);
    expect(body.checklist_items.map((item) => item.text)).toEqual(['first', 'second']);

    const activity = await db
      .selectFrom('task_activity')
      .select(['kind', 'actor_user_id'])
      .where('task_id', '=', cards[0].id)
      .execute();
    expect(activity).toEqual([{ kind: 'created', actor_user_id: owner.id }]);

    const after = await seriesRow(series.id);
    expect(after.next_occurrence_date).toBe(addDays(today, 1));
    expect(after.last_occurrence_date).toBe(today);
    expect(after.missed_occurrence_count).toBe(0);
    expect(after.open_occurrence_count).toBe(1);
  });

  it('outlives the account that created it and credits the project owner instead', async () => {
    const author = await ctx.createUser('mat-author');
    const joined = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [member.id, author.id],
      roles: [
        { user_id: member.id, role: 'editor' },
        { user_id: author.id, role: 'editor' },
      ],
    });
    expect(joined.status).toBe(204);

    const res = await ctx.request(author.token).post('/api/task-series', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'Outlives its author',
      preset: 'daily',
      start_date: seriesStart,
      timezone: 'UTC',
    });
    expect(res.status, await res.clone().text()).toBe(201);
    const series = (await res.json()) as SeriesBody;
    expect(series.created_by).toBe(author.id);

    await db.deleteFrom('app_user').where('id', '=', author.id).execute();
    expect((await seriesRow(series.id)).created_by).toBeNull();

    expect(await runSeriesSweep()).toBe(1);
    const cards = await tasksOf(series.id);
    expect(cards).toHaveLength(1);

    const activity = await db
      .selectFrom('task_activity')
      .select(['kind', 'actor_user_id'])
      .where('task_id', '=', cards[0].id)
      .execute();
    expect(activity).toEqual([{ kind: 'created', actor_user_id: owner.id }]);

    const restore = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [member.id],
      roles: [{ user_id: member.id, role: 'editor' }],
    });
    expect(restore.status).toBe(204);
  });

  it('carries an active series into a copied project and schedules it from today', async () => {
    const [sourceProject, sourceColumn] = await createProject('series copy source');
    const joined = await ctx.request(owner.token).put(`/api/projects/${sourceProject}/members`, {
      user_ids: [member.id],
      roles: [{ user_id: member.id, role: 'editor' }],
    });
    expect(joined.status).toBe(204);

    const labelId = newId();
    expect(
      (
        await ctx.request(owner.token).post('/api/labels', {
          id: labelId,
          project_id: sourceProject,
          name: 'ops',
          color: '#ff00ff',
        })
      ).status
    ).toBe(201);

    const source = await createSeries({
      project_id: sourceProject,
      column_id: sourceColumn,
      title: 'Weekly standup',
      label_ids: [labelId],
      assignee_ids: [owner.id, member.id],
      checklist_items: [{ text: 'agenda' }],
    });
    // A schedule the source itself has already fallen behind on: the copy must
    // not inherit the stale day and fire it on arrival.
    const sourceToday = todayOf(source);
    await forceDue(source.id, addDays(sourceToday, -3), await noonIn(sourceToday, 'UTC'));

    const copyId = newId();
    projectIds.push(copyId);
    const copied = await ctx
      .request(owner.token)
      .post('/api/projects', { id: copyId, name: 'copy', source_project_id: sourceProject });
    expect(copied.status, await copied.clone().text()).toBe(201);
    const copyBoard = (await copied.json()) as {
      columns: { id: string; name: string }[];
      labels: { id: string; name: string }[];
    };
    const copyColumn = copyBoard.columns.find((column) => column.name === 'Backlog');
    expect(copyColumn).toBeDefined();

    const [copy] = await seriesOf(copyId);
    expect(copy).toBeDefined();
    expect(copy.id).not.toBe(source.id);
    expect(copy.status).toBe('active');
    expect(copy.created_by).toBe(owner.id);
    expect(copy.column_id).toBe(copyColumn?.id);
    expect(copy.label_ids).toEqual([copyBoard.labels[0].id]);
    expect(copyBoard.labels[0].id).not.toBe(labelId);
    // The copy starts personal, so the source's other editor has no access to it.
    expect(copy.assignee_ids).toEqual([owner.id]);
    expect(copy.checklist_items.map((item) => item.text)).toEqual(['agenda']);
    // The copy row and the day it was scheduled on both come from the copying
    // transaction's now(), so its own created_at is the day it started from.
    const today = todayOf(copy);
    expect(today).toBe(await todayIn('UTC', new Date(copy.created_at)));
    expect(copy.missed_occurrence_count).toBe(0);

    await runSeriesSweep({ now: await noonIn(today, 'UTC') });
    const cards = await tasksOf(copy.id);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      title: 'Weekly standup',
      column_id: copyColumn?.id,
      series_occurrence_date: today,
    });
  });

  it('leaves a paused series paused in the copy', async () => {
    const [sourceProject, sourceColumn] = await createProject('paused copy source');
    const source = await createSeries({ project_id: sourceProject, column_id: sourceColumn });
    expect(
      (await ctx.request(owner.token).patch(`/api/task-series/${source.id}`, { status: 'paused' }))
        .status
    ).toBe(200);

    const copyId = newId();
    projectIds.push(copyId);
    expect(
      (
        await ctx.request(owner.token).post('/api/projects', {
          id: copyId,
          name: 'paused copy',
          source_project_id: sourceProject,
        })
      ).status
    ).toBe(201);

    const [copy] = await seriesOf(copyId);
    expect(copy.status).toBe('paused');
    await runSeriesSweep();
    expect(await tasksOf(copy.id)).toHaveLength(0);
  });

  it('names the schedule on a card that came from one, and on nothing else', async () => {
    const series = await createSeries({ title: 'Repeating' });
    expect(await runSeriesSweep()).toBe(1);
    const [card] = await tasksOf(series.id);

    const detail = await ctx.request(owner.token).get(`/api/tasks/${card.id}`);
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { series_summary: string | null }).series_summary).toBe(
      'Every day'
    );

    const plainId = newId();
    await db
      .insertInto('task')
      .values({
        id: plainId,
        project_id: projectId,
        column_id: columnId,
        title: 'ordinary',
        sort_key: rankKey(9000),
      })
      .execute();
    const plain = await ctx.request(owner.token).get(`/api/tasks/${plainId}`);
    expect(((await plain.json()) as { series_summary: string | null }).series_summary).toBeNull();

    expect((await ctx.request(owner.token).delete(`/api/task-series/${series.id}`)).status).toBe(
      204
    );
    const orphaned = await ctx.request(owner.token).get(`/api/tasks/${card.id}`);
    expect(
      ((await orphaned.json()) as { series_summary: string | null }).series_summary
    ).toBeNull();
  });

  it('creates nothing before the day the occurrence falls on', async () => {
    const today = await todayIn('UTC');
    const at = await noonIn(today, 'UTC');
    const series = await createSeries({ preset: 'weekly', start_date: addDays(today, 3) });
    expect(await runSeriesSweep({ now: at })).toBe(0);
    expect(await tasksOf(series.id)).toHaveLength(0);
    expect((await seriesRow(series.id)).next_occurrence_date).toBe(addDays(today, 3));
  });

  it('creates exactly one card across repeated sweeps', async () => {
    const series = await createSeries();
    await runSeriesSweep();
    await runSeriesSweep();
    expect(await tasksOf(series.id)).toHaveLength(1);
  });

  it('creates exactly one card across concurrent sweeps', async () => {
    const series = await createSeries();
    await Promise.all([runSeriesSweep(), runSeriesSweep(), runSeriesSweep()]);
    expect(await tasksOf(series.id)).toHaveLength(1);
  });

  it('lets the unique index catch a rewound schedule without failing the run', async () => {
    const series = await createSeries();
    const today = todayOf(series);
    const at = await noonIn(today, 'UTC');
    await runSeriesSweep({ now: at });
    expect(await tasksOf(series.id)).toHaveLength(1);

    await forceDue(series.id, today, at);
    await expect(runSeriesSweep({ now: at })).resolves.toBe(1);

    expect(await tasksOf(series.id)).toHaveLength(1);
    const after = await seriesRow(series.id);
    expect(after.next_occurrence_date).toBe(addDays(today, 1));
    expect(after.last_error).toBeNull();
  });

  it('skips a backlog forward instead of spawning stale cards', async () => {
    const series = await createSeries({ start_date: addDays(seriesStart, -30) });
    const today = todayOf(series);
    const at = await noonIn(today, 'UTC');
    await forceDue(series.id, addDays(today, -3), at);

    expect(await runSeriesSweep({ now: at })).toBe(1);

    const cards = await tasksOf(series.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].series_occurrence_date).toBe(today);

    const after = await seriesRow(series.id);
    expect(after.missed_occurrence_count).toBe(3);
    expect(after.last_missed_date).toBe(addDays(today, -1));
  });

  it('records no misses for a sweep that merely ran late', async () => {
    const series = await createSeries();
    const today = todayOf(series);
    const at = await noonIn(today, 'UTC');
    await db
      .updateTable('task_series')
      .set({ next_occurrence_at: sql<Date>`${at}::timestamptz - interval '90 seconds'` })
      .where('id', '=', series.id)
      .execute();

    await runSeriesSweep({ now: at });
    expect(await tasksOf(series.id)).toHaveLength(1);
    const after = await seriesRow(series.id);
    expect(after.missed_occurrence_count).toBe(0);
    expect(after.last_occurrence_date).toBe(today);
  });

  it('converges after a backlog longer than one scan', async () => {
    const backlog = MAX_CATCHUP_SCAN + 100;
    const series = await createSeries({ start_date: addDays(seriesStart, -(backlog + 10)) });
    const today = todayOf(series);
    const at = await noonIn(today, 'UTC');
    await forceDue(series.id, addDays(today, -backlog), at);

    await runSeriesSweep({ now: at });
    expect(await tasksOf(series.id)).toHaveLength(0);
    const midway = await seriesRow(series.id);
    expect(midway.missed_occurrence_count).toBe(MAX_CATCHUP_SCAN);
    expect(midway.next_occurrence_date).toBe(addDays(today, -(backlog - MAX_CATCHUP_SCAN)));

    await runSeriesSweep({ now: at });
    const cards = await tasksOf(series.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].series_occurrence_date).toBe(today);
    expect((await seriesRow(series.id)).missed_occurrence_count).toBe(backlog);
  });

  it('still creates today’s card when the backlog fills the scan exactly', async () => {
    const series = await createSeries({
      start_date: addDays(seriesStart, -(MAX_CATCHUP_SCAN + 10)),
    });
    const today = todayOf(series);
    const at = await noonIn(today, 'UTC');
    await forceDue(series.id, addDays(today, -(MAX_CATCHUP_SCAN - 1)), at);

    expect(await runSeriesSweep({ now: at })).toBe(1);

    const cards = await tasksOf(series.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].series_occurrence_date).toBe(today);
    const after = await seriesRow(series.id);
    expect(after.missed_occurrence_count).toBe(MAX_CATCHUP_SCAN - 1);
    expect(after.next_occurrence_date).toBe(addDays(today, 1));
  });

  it('materialises exactly the occurrence that fell today and nothing beyond it', async () => {
    const daily = await createSeries();
    const today = todayOf(daily);
    await runSeriesSweep({ now: await noonIn(today, 'UTC') });
    expect((await tasksOf(daily.id)).map((task) => task.series_occurrence_date)).toEqual([today]);
    expect((await seriesRow(daily.id)).next_occurrence_date).toBe(addDays(today, 1));
  });

  it('copies the template due date onto every card and derives none from the occurrence', async () => {
    const undated = await createSeries();
    const dated = await createSeries({ due_date: '2027-06-15' });
    const today = todayOf(dated);

    await runSeriesSweep({ now: await noonIn(today, 'UTC') });

    const [plain] = await tasksOf(undated.id);
    expect(plain.series_occurrence_date).toBe(today);
    expect(plain.due_date).toBeNull();

    const [carried] = await tasksOf(dated.id);
    expect(carried.series_occurrence_date).toBe(today);
    expect(carried.due_date).toBe('2027-06-15');
  });

  it('creates the next occurrence even while the previous card is still open', async () => {
    const series = await createSeries();
    const today = todayOf(series);
    const at = await noonIn(today, 'UTC');
    await runSeriesSweep({ now: at });
    const [first] = await tasksOf(series.id);

    // Re-labels the card the sweep just made as yesterday's, so today's is a
    // genuine second occurrence with the first one still unfinished.
    await db
      .updateTable('task')
      .set({ series_occurrence_date: addDays(today, -1) })
      .where('id', '=', first.id)
      .execute();
    await forceDue(series.id, today, at);

    await runSeriesSweep({ now: at });
    expect(await tasksOf(series.id)).toHaveLength(2);
    expect((await seriesRow(series.id)).open_occurrence_count).toBe(2);
  });

  it('never sweeps a paused or ended series', async () => {
    for (const status of ['paused', 'ended']) {
      const series = await createSeries();
      const today = todayOf(series);
      const at = await noonIn(today, 'UTC');
      await db
        .updateTable('task_series')
        .set({
          status,
          next_occurrence_date: today,
          next_occurrence_at: sql<Date>`${at}::timestamptz - interval '1 minute'`,
        })
        .where('id', '=', series.id)
        .execute();
      expect(await runSeriesSweep({ now: at })).toBe(0);
      expect(await tasksOf(series.id)).toHaveLength(0);
      await db.deleteFrom('task_series').where('id', '=', series.id).execute();
    }
  });

  it('ends a series whose rule is exhausted', async () => {
    // A day out rather than today: the rule has exactly one occurrence, and
    // which day that is then does not depend on whether the calendar rolled
    // over between reading today and the request that stores the rule.
    const day = addDays(await todayIn('UTC'), 1);
    const series = await createSeries({
      preset: undefined,
      rrule: 'FREQ=DAILY;COUNT=1',
      start_date: day,
    });
    const at = await noonIn(day, 'UTC');
    await runSeriesSweep({ now: at });

    expect(await tasksOf(series.id)).toHaveLength(1);
    const after = await seriesRow(series.id);
    expect(after.status).toBe('ended');
    expect(after.ended_at).not.toBeNull();
    expect(after.next_occurrence_date).toBeNull();
    expect(after.last_occurrence_date).toBe(day);

    expect(await runSeriesSweep({ now: at })).toBe(0);
    expect(await tasksOf(series.id)).toHaveLength(1);
  });

  it('stops sweeping and reports nothing when the destination column is deleted', async () => {
    const [tempProject, tempColumn] = await createProject('column gone');
    const series = await createSeries({ project_id: tempProject, column_id: tempColumn });
    expect((await ctx.request(owner.token).delete(`/api/columns/${tempColumn}`)).status).toBe(204);

    await expect(runSeriesSweep()).resolves.toBe(0);
    expect(await tasksOf(series.id)).toHaveLength(0);
    const row = await db
      .selectFrom('task_series')
      .select(['column_id', 'consecutive_failures', 'last_error', 'status'])
      .where('id', '=', series.id)
      .executeTakeFirstOrThrow();
    expect(row.column_id).toBeNull();
    expect(row.consecutive_failures).toBe(0);
    expect(row.last_error).toBeNull();
    expect(row.status).toBe('active');
  });

  it('drops an assignee who lost access and a label that was deleted', async () => {
    const labelId = newId();
    await ctx
      .request(owner.token)
      .post('/api/labels', { id: labelId, project_id: projectId, name: 'x', color: '#00ff00' });
    const series = await createSeries({
      label_ids: [labelId],
      assignee_ids: [member.id, owner.id],
    });

    expect((await ctx.request(owner.token).delete(`/api/labels/${labelId}`)).status).toBe(204);
    const members = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [], roles: [] });
    expect(members.status).toBe(204);

    await runSeriesSweep();
    const [card] = await tasksOf(series.id);
    const detail = await ctx.request(owner.token).get(`/api/tasks/${card.id}`);
    const body = (await detail.json()) as { label_ids: string[]; assignee_ids: string[] };
    expect(body.label_ids).toEqual([]);
    expect(body.assignee_ids).toEqual([owner.id]);

    const restore = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [member.id],
      roles: [{ user_id: member.id, role: 'editor' }],
    });
    expect(restore.status).toBe(204);
  });

  it('never accretes cards in an archived project', async () => {
    const [tempProject, tempColumn] = await createProject('archived');
    const series = await createSeries({ project_id: tempProject, column_id: tempColumn });
    const archived = await ctx
      .request(owner.token)
      .patch(`/api/projects/${tempProject}`, { archived_at: new Date().toISOString() });
    expect(archived.status).toBe(200);

    expect(await runSeriesSweep()).toBe(0);
    expect(await tasksOf(series.id)).toHaveLength(0);
  });

  it('isolates a broken series and pauses it after repeated failures', async () => {
    const healthy = await createSeries({ title: 'healthy' });
    const poison = await createSeries({ title: 'poison' });
    const today = todayOf(poison);
    const at = await noonIn(today, 'UTC');
    await db
      .updateTable('task_series')
      .set({ rrule: 'not a rule at all' })
      .where('id', '=', poison.id)
      .execute();

    await expect(runSeriesSweep({ now: at })).resolves.toBe(2);
    expect(await tasksOf(healthy.id)).toHaveLength(1);
    expect(await tasksOf(poison.id)).toHaveLength(0);

    let row = await db
      .selectFrom('task_series')
      .select(['consecutive_failures', 'last_error', 'status'])
      .where('id', '=', poison.id)
      .executeTakeFirstOrThrow();
    expect(row.consecutive_failures).toBe(1);
    expect(row.last_error).not.toBeNull();
    expect(row.status).toBe('active');

    for (let attempt = 2; attempt <= MAX_CONSECUTIVE_FAILURES; attempt++) {
      await forceDue(poison.id, today, at);
      await runSeriesSweep({ now: at });
    }

    row = await db
      .selectFrom('task_series')
      .select(['consecutive_failures', 'last_error', 'status'])
      .where('id', '=', poison.id)
      .executeTakeFirstOrThrow();
    expect(row.consecutive_failures).toBeGreaterThanOrEqual(MAX_CONSECUTIVE_FAILURES);
    expect(row.status).toBe('paused');
  });

  it('bounds one run to a single batch and finishes the rest on the next', async () => {
    const batch: SeriesBody[] = [];
    for (let i = 0; i < SWEEP_BATCH + 1; i++) {
      batch.push(await createSeries({ title: `batched ${String(i)}` }));
    }
    const created = batch.map((series) => series.id);
    const at = await noonIn(todayOf(batch[batch.length - 1]), 'UTC');

    expect(await runSeriesSweep({ now: at })).toBe(SWEEP_BATCH);
    const afterFirst = await db
      .selectFrom('task')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task.series_id', 'in', created)
      .executeTakeFirstOrThrow();
    expect(Number(afterFirst.count)).toBe(SWEEP_BATCH);

    expect(await runSeriesSweep({ now: at })).toBe(1);
    const afterSecond = await db
      .selectFrom('task')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task.series_id', 'in', created)
      .executeTakeFirstOrThrow();
    expect(Number(afterSecond.count)).toBe(SWEEP_BATCH + 1);
  });

  it('reads the calendar day in each series own timezone', async () => {
    const ahead = 'Pacific/Kiritimati';
    const behind = 'Pacific/Niue';
    // Behind first, because the instant pinned below comes from the ahead
    // series: its day in the behind zone is only guaranteed to be on or after
    // the day a behind series created before it was scheduled on.
    const second = await createSeries({ timezone: behind, start_date: addDays(seriesStart, -10) });
    const first = await createSeries({ timezone: ahead, start_date: addDays(seriesStart, -10) });
    expect(todayOf(second)).toBe(await todayIn(behind, new Date(second.created_at)));
    expect(todayOf(first)).toBe(await todayIn(ahead, new Date(first.created_at)));

    const at = await noonIn(todayOf(first), ahead);
    const aheadToday = await todayIn(ahead, at);
    const behindToday = await todayIn(behind, at);
    // The two zones are 25 hours apart, so their calendar days never coincide.
    expect(aheadToday > behindToday).toBe(true);

    await runSeriesSweep({ now: at });
    expect((await tasksOf(first.id))[0].series_occurrence_date).toBe(aheadToday);
    expect((await tasksOf(second.id))[0].series_occurrence_date).toBe(behindToday);
  });

  it('pushes the new card to subscribed members and nobody else', async () => {
    const subscriber = await RtClient.connect(port, member.token);
    subscriber.subscribe(projectId);
    const stranger = await RtClient.connect(port, outsider.token);
    stranger.subscribe(projectId);
    await settle();
    const from = subscriber.events.length;

    const series = await createSeries({ title: 'pushed' });
    const today = todayOf(series);
    await runSeriesSweep({ now: await noonIn(today, 'UTC') });

    const created = await subscriber.waitForEvent((event) => event.type === 'task_created', {
      from,
    });
    expect(Object.keys(created.data).sort()).toEqual([...BOARD_TASK_KEYS].sort());
    expect(created.data.title).toBe('pushed');
    expect(created.project_id).toBe(projectId);
    // A sweep has no session to read an actor from, so the card names whoever
    // set the schedule up rather than nobody.
    expect(created.data.actor_user_id).toBe(owner.id);

    const changed = await subscriber.waitForEvent((event) => event.type === 'project_changed', {
      from,
    });
    expect(changed.data).toEqual({ id: projectId, actor_user_id: owner.id });

    await settle();
    expect(stranger.events.filter((event) => event.type === 'task_created')).toEqual([]);

    const advanced = await subscriber.waitForEvent(
      (event) => event.type === 'series_updated' && event.data.id === series.id,
      { from }
    );
    expect(advanced.project_id).toBe(projectId);
    expect(advanced.data.next_occurrence_date).toBe(addDays(today, 1));
    expect(advanced.data.open_occurrence_count).toBe(1);

    await settle();
    expect(stranger.events.filter((event) => event.type === 'task_created')).toEqual([]);
    expect(stranger.events.filter((event) => event.type === 'series_updated')).toEqual([]);

    subscriber.close();
    stranger.close();
    expect(await tasksOf(series.id)).toHaveLength(1);
  });

  // Weekly from 60 days back falls on neither today nor any day since the one
  // forced due, so the sweep advances the schedule and creates nothing.
  it('pushes the advanced schedule even when the sweep creates no card', async () => {
    const subscriber = await RtClient.connect(port, member.token);
    subscriber.subscribe(projectId);
    await settle();
    const from = subscriber.events.length;

    const today = await todayIn('UTC');
    const at = await noonIn(today, 'UTC');
    const series = await createSeries({ preset: 'weekly', start_date: addDays(today, -60) });
    await forceDue(series.id, addDays(today, -4), at);

    expect(await runSeriesSweep({ now: at })).toBe(1);
    expect(await tasksOf(series.id)).toHaveLength(0);

    const advanced = await subscriber.waitForEvent(
      (event) => event.type === 'series_updated' && event.data.id === series.id,
      { from }
    );
    expect(advanced.data.missed_occurrence_count).toBe(1);
    expect(advanced.data.next_occurrence_date).toBe(addDays(today, 3));

    await settle();
    expect(subscriber.events.slice(from).filter((event) => event.type === 'task_created')).toEqual(
      []
    );
    subscriber.close();
  });

  it('pushes the recorded failure and the pause it eventually forces', async () => {
    const subscriber = await RtClient.connect(port, member.token);
    subscriber.subscribe(projectId);
    await settle();
    const from = subscriber.events.length;

    const poison = await createSeries({ title: 'broadcast poison' });
    const today = todayOf(poison);
    const at = await noonIn(today, 'UTC');
    await db
      .updateTable('task_series')
      .set({ rrule: 'not a rule at all' })
      .where('id', '=', poison.id)
      .execute();

    await runSeriesSweep({ now: at });
    const failed = await subscriber.waitForEvent(
      (event) => event.type === 'series_updated' && event.data.id === poison.id,
      { from }
    );
    expect(failed.data.last_error).not.toBeNull();
    expect(failed.data.status).toBe('active');

    for (let attempt = 2; attempt <= MAX_CONSECUTIVE_FAILURES; attempt++) {
      await forceDue(poison.id, today, at);
      await runSeriesSweep({ now: at });
    }

    await subscriber.waitForEvent(
      (event) =>
        event.type === 'series_updated' &&
        event.data.id === poison.id &&
        event.data.status === 'paused',
      { from }
    );
    subscriber.close();
  });

  it('queues exactly one webhook delivery per card', async () => {
    const webhookId = newId();
    const registered = await ctx.request(owner.token).post('/api/webhooks', {
      id: webhookId,
      project_id: projectId,
      url: 'https://example.com/series',
    });
    expect(registered.status).toBe(201);
    await db.deleteFrom('webhook_delivery').where('webhook_id', '=', webhookId).execute();

    await createSeries();
    await runSeriesSweep();

    const deliveries = await db
      .selectFrom('webhook_delivery')
      .select(['event_type', 'status'])
      .where('webhook_id', '=', webhookId)
      .execute();
    expect(deliveries).toEqual([{ event_type: 'task_created', status: 'pending' }]);

    await ctx.request(owner.token).delete(`/api/webhooks/${webhookId}`);
  });

  describe('job wiring', () => {
    it('registers within the runner limits', () => {
      expect(SWEEP_TIMEOUT_MS).toBeLessThanOrEqual(MAX_HANDLER_TIMEOUT_MS);
      expect(SWEEP_INTERVAL_SECONDS).toBeGreaterThan(0);
      expect(() => registerTaskSeriesJob()).not.toThrow();
    });

    it('runs the sweep from one periodic job row', async () => {
      registerTaskSeriesJob();
      const series = await createSeries();

      await runJobMaintenance();
      const rows = await db
        .selectFrom('job')
        .select(['kind', 'interval_seconds'])
        .where('kind', '=', TASK_SERIES_JOB_KIND)
        .execute();
      expect(rows).toEqual([
        { kind: TASK_SERIES_JOB_KIND, interval_seconds: SWEEP_INTERVAL_SECONDS },
      ]);

      await db
        .updateTable('job')
        .set({ run_at: new Date() })
        .where('kind', '=', TASK_SERIES_JOB_KIND)
        .execute();
      await expect(runDueJobs()).resolves.toBe(1);
      expect(await tasksOf(series.id)).toHaveLength(1);

      const job = await db
        .selectFrom('job')
        .selectAll()
        .where('kind', '=', TASK_SERIES_JOB_KIND)
        .executeTakeFirstOrThrow();
      expect(job.last_error).toBeNull();
      expect(job.attempts).toBe(0);
    });

    it('never backs the schedule off because one series is broken', async () => {
      registerTaskSeriesJob();
      const poison = await createSeries();
      await db
        .updateTable('task_series')
        .set({ rrule: 'not a rule at all' })
        .where('id', '=', poison.id)
        .execute();

      await runJobMaintenance();
      await db
        .updateTable('job')
        .set({ run_at: new Date() })
        .where('kind', '=', TASK_SERIES_JOB_KIND)
        .execute();
      await expect(runDueJobs()).resolves.toBe(1);

      const job = await db
        .selectFrom('job')
        .selectAll()
        .where('kind', '=', TASK_SERIES_JOB_KIND)
        .executeTakeFirstOrThrow();
      expect(job.last_error).toBeNull();
      expect(job.attempts).toBe(0);
    });
  });
});
