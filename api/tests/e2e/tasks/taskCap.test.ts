import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { MAX_TASKS_PER_PROJECT } from '../../../src/config/constants';
import { keysBetween } from '../../../src/services/sortKey';
import { MAX_CONSECUTIVE_FAILURES, runSeriesSweep } from '../../../src/services/taskSeries/index';

describe(`the ${String(MAX_TASKS_PER_PROJECT)}-task ceiling`, () => {
  const ctx = new TestContext();
  let owner: TestUser;
  let projectId: string;
  let columnId: string;
  let spareColumnId: string;

  // One filling statement rather than MAX_TASKS_PER_PROJECT requests: the cap is
  // what is under test, not the create route, and 5,000 round trips would
  // dominate the suite. The keys come from the real generator so a later
  // successful append still has a valid tail to extend.
  async function fillColumn(targetColumnId: string, count: number): Promise<void> {
    if (count <= 0) return;
    const tail = await db
      .selectFrom('task')
      .select((eb) => eb.fn.max('task.sort_key').as('max_key'))
      .where('task.column_id', '=', targetColumnId)
      .executeTakeFirst();
    const ids = Array.from({ length: count }, () => newId());
    const keys = keysBetween(tail?.max_key ?? null, null, count);
    await sql`
      insert into task (id, project_id, column_id, title, sort_key)
      select unnest(${ids}::uuid[]), ${projectId}::uuid, ${targetColumnId}::uuid, 'filler',
             unnest(${keys}::text[])
    `.execute(db);
  }

  async function taskCount(): Promise<number> {
    const { count } = await db
      .selectFrom('task')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task.project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    return Number(count);
  }

  // Trims as well as fills, so every case below states the board it needs rather
  // than inheriting whatever its siblings left — which is what lets the file run
  // under --sequence.shuffle.
  async function setTaskCount(target: number): Promise<void> {
    const surplus = (await taskCount()) - target;
    if (surplus > 0) {
      await sql`
        delete from task
        where ctid in (
          select ctid from task
          where project_id = ${projectId}::uuid and title = 'filler'
          limit ${surplus}
        )
      `.execute(db);
    }
    await fillColumn(spareColumnId, target - (await taskCount()));
    expect(await taskCount()).toBe(target);
  }

  const fillToCeiling = (): Promise<void> => setTaskCount(MAX_TASKS_PER_PROJECT);

  beforeAll(async () => {
    owner = await ctx.createUser('task-cap');
    projectId = newId();
    const created = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'Full board' });
    expect(created.status).toBe(201);
    const board = await created.json<{ columns: { id: string }[] }>();
    columnId = board.columns[0]!.id;
    spareColumnId = board.columns[1]!.id;

    await fillColumn(columnId, MAX_TASKS_PER_PROJECT - 1);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('allows the card that lands exactly on the ceiling and refuses the next', async () => {
    await setTaskCount(MAX_TASKS_PER_PROJECT - 1);

    const last = await ctx.request(owner.token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'the last one that fits',
    });
    expect(last.status).toBe(201);
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);

    const refused = await ctx.request(owner.token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'one too many',
    });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toBe(
      `Project already holds the maximum of ${String(MAX_TASKS_PER_PROJECT)} tasks`
    );
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);
  });

  it('refuses a batch that would cross the ceiling and creates none of it', async () => {
    await fillToCeiling();

    const res = await ctx.request(owner.token).post('/api/tasks/batch', {
      project_id: projectId,
      column_id: columnId,
      tasks: [
        { id: newId(), title: 'a' },
        { id: newId(), title: 'b' },
      ],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(String(MAX_TASKS_PER_PROJECT));
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);
  });

  it('refuses a task duplicate', async () => {
    await fillToCeiling();
    const source = await db
      .selectFrom('task')
      .select('id')
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();

    const res = await ctx
      .request(owner.token)
      .post(`/api/tasks/${source.id}/duplicate`, { id: newId() });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(String(MAX_TASKS_PER_PROJECT));
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);
  });

  it('refuses a column duplicate and creates neither the column nor its cards', async () => {
    await fillToCeiling();
    const newColumnId = newId();

    const res = await ctx
      .request(owner.token)
      .post(`/api/columns/${columnId}/duplicate`, { id: newColumnId });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(String(MAX_TASKS_PER_PROJECT));
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', newColumnId)
      .executeTakeFirst();
    expect(column).toBeUndefined();
  });

  // The guard is about the rows a copy would add, not about the board being
  // full, so a column holding nothing is still duplicable at the ceiling.
  it('still duplicates a column that would add no cards', async () => {
    await fillToCeiling();
    const emptyColumnId = newId();
    const empty = await ctx.request(owner.token).post('/api/columns', {
      id: emptyColumnId,
      project_id: projectId,
      name: 'Empty',
    });
    expect(empty.status).toBe(201);

    const res = await ctx
      .request(owner.token)
      .post(`/api/columns/${emptyColumnId}/duplicate`, { id: newId() });
    expect(res.status).toBe(201);
  });

  it('keeps reads and edits working on a board sitting at the ceiling', async () => {
    await fillToCeiling();
    const task = await db
      .selectFrom('task')
      .select('id')
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();

    const board = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    expect(board.status).toBe(200);
    expect((await board.json()).tasks).toHaveLength(MAX_TASKS_PER_PROJECT);

    const edited = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${task.id}`, { title: 'renamed at the ceiling' });
    expect(edited.status).toBe(200);
    expect((await edited.json()).title).toBe('renamed at the ceiling');
  });

  // Archived cards hold rows and sort keys just like live ones, so exempting
  // them would leave the ceiling unbounded to anyone archiving as they go.
  it('counts archived cards toward the ceiling', async () => {
    await fillToCeiling();
    const victim = await db
      .selectFrom('task')
      .select('id')
      .where('project_id', '=', projectId)
      .where('archived_at', 'is', null)
      .executeTakeFirstOrThrow();

    expect((await ctx.request(owner.token).post(`/api/tasks/${victim.id}/archive`)).status).toBe(
      200
    );

    const refused = await ctx.request(owner.token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'the archive is not a loophole',
    });
    expect(refused.status).toBe(422);

    expect((await ctx.request(owner.token).post(`/api/tasks/${victim.id}/restore`)).status).toBe(
      200
    );
  });

  it('refuses to promote a checklist item and keeps the item', async () => {
    await fillToCeiling();
    const parent = await db
      .selectFrom('task')
      .select('id')
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();

    const itemId = newId();
    const item = await ctx.request(owner.token).post('/api/checklist-items', {
      id: itemId,
      task_id: parent.id,
      text: 'promote me',
    });
    expect(item.status).toBe(201);

    const res = await ctx
      .request(owner.token)
      .post(`/api/checklist-items/${itemId}/promote`, { id: newId() });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(String(MAX_TASKS_PER_PROJECT));
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);

    const survived = await db
      .selectFrom('checklist_item')
      .select('id')
      .where('id', '=', itemId)
      .executeTakeFirst();
    expect(survived?.id).toBe(itemId);
  });

  // A background job that quietly stopped producing cards would be invisible, so
  // a full board goes through the failure machinery the series already has: the
  // reason lands in last_error, and a board that stays full parks the series in
  // paused rather than retrying forever.
  it('routes the recurring sweep through the series failure machinery', async () => {
    await fillToCeiling();

    const { rows } = await sql<{ today: string }>`
      select to_char((now() at time zone 'UTC')::date, 'YYYY-MM-DD') as today
    `.execute(db);
    const today = rows[0]!.today;

    const seriesId = newId();
    const created = await ctx.request(owner.token).post('/api/task-series', {
      id: seriesId,
      project_id: projectId,
      column_id: columnId,
      title: 'Daily standup on a full board',
      preset: 'daily',
      start_date: today,
      timezone: 'UTC',
    });
    expect(created.status).toBe(201);

    const seriesRow = async () =>
      db
        .selectFrom('task_series')
        .select(['status', 'consecutive_failures', 'last_error', 'next_occurrence_at'])
        .where('id', '=', seriesId)
        .executeTakeFirstOrThrow();

    await runSeriesSweep();

    const failed = await seriesRow();
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);
    expect(failed.consecutive_failures).toBeGreaterThanOrEqual(1);
    expect(failed.last_error).toContain(String(MAX_TASKS_PER_PROJECT));

    for (let attempt = failed.consecutive_failures; attempt < MAX_CONSECUTIVE_FAILURES; attempt++) {
      await db
        .updateTable('task_series')
        .set({
          next_occurrence_date: today,
          next_occurrence_at: sql<Date>`now() - interval '1 minute'`,
          status: 'active',
        })
        .where('id', '=', seriesId)
        .execute();
      await runSeriesSweep();
    }

    const parked = await seriesRow();
    expect(parked.status).toBe('paused');
    expect(parked.next_occurrence_at).toBeNull();
    expect(parked.last_error).toContain(String(MAX_TASKS_PER_PROJECT));
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT);

    await db.deleteFrom('task_series').where('id', '=', seriesId).execute();
  });

  // The copy used to run an unchunked insert of seven bound columns per row, so
  // a source this size answered 500 from Postgres' 65,535-parameter cap rather
  // than refusing.
  it('refuses a project copy whose source is over the ceiling rather than failing', async () => {
    await fillToCeiling();
    await fillColumn(spareColumnId, 1);
    expect(await taskCount()).toBe(MAX_TASKS_PER_PROJECT + 1);

    const copyId = newId();
    const res = await ctx.request(owner.token).post('/api/projects', {
      id: copyId,
      name: 'Copy of a full board',
      source_project_id: projectId,
    });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain(String(MAX_TASKS_PER_PROJECT));

    const project = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', copyId)
      .executeTakeFirst();
    expect(project).toBeUndefined();
  });
});
