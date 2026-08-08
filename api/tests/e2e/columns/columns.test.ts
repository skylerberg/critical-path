import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { db } from '../../../src/db/index';
import { newId, rankKey } from '../../helpers/fixtures';

const key2000 = rankKey(2000);

const ctx = new TestContext();
let token: string;
let userId: string;
const projectIds: string[] = [];

async function createProject(): Promise<string> {
  const id = newId();
  await db
    .insertInto('project')
    .values({ id, name: `columns-e2e ${id.slice(0, 8)}`, created_by: userId })
    .execute();
  projectIds.push(id);
  return id;
}

async function insertColumn(
  projectId: string,
  opts: { name?: string; sort_key?: string; is_done?: boolean } = {}
): Promise<string> {
  const id = newId();
  await db
    .insertInto('board_column')
    .values({
      id,
      project_id: projectId,
      name: opts.name ?? 'Column',
      sort_key: opts.sort_key ?? rankKey(),
      is_done: opts.is_done ?? false,
    })
    .execute();
  return id;
}

async function insertTask(projectId: string, columnId: string, position: number): Promise<string> {
  const id = newId();
  await db
    .insertInto('task')
    .values({
      id,
      project_id: projectId,
      column_id: columnId,
      title: 'Task',
      sort_key: rankKey(position),
    })
    .execute();
  return id;
}

async function activityOf(taskId: string): Promise<unknown[]> {
  const res = await ctx.request(token).get(`/api/tasks/${taskId}/activity`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { activity: unknown[] }).activity;
}

async function updatedAt(taskId: string): Promise<string> {
  const row = await db
    .selectFrom('task')
    .select('updated_at')
    .where('id', '=', taskId)
    .executeTakeFirstOrThrow();
  return row.updated_at.toISOString();
}

function tasksInColumn(columnId: string) {
  return db
    .selectFrom('task')
    .select(['id', 'column_id', 'sort_key'])
    .where('column_id', '=', columnId)
    .orderBy('sort_key')
    .execute();
}

beforeAll(async () => {
  const user = await ctx.createUser('columns');
  token = user.token;
  userId = user.id;
});

afterAll(async () => {
  if (projectIds.length > 0) {
    await db.deleteFrom('project').where('id', 'in', projectIds).execute();
  }
  await ctx.cleanup();
});

describe('POST /api/columns', () => {
  it('requires auth', async () => {
    const res = await ctx.request().post('/api/columns', {
      id: newId(),
      project_id: newId(),
      name: 'Unauthorized',
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(401);
  });

  const key2500 = rankKey(2500);
  it('creates a column with is_done defaulting to false', async () => {
    const projectId = await createProject();
    const id = newId();

    const res = await ctx.request(token).post('/api/columns', {
      id,
      project_id: projectId,
      name: 'Review',
      sort_key: key2500,
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toEqual({
      id,
      project_id: projectId,
      name: 'Review',
      sort_key: key2500,
      is_done: false,
      created_at: expect.any(String),
    });
    expect(new Date(body.created_at).getTime()).not.toBeNaN();
  });

  it('creates a done column when is_done is true', async () => {
    const projectId = await createProject();
    const id = newId();

    const res = await ctx.request(token).post('/api/columns', {
      id,
      project_id: projectId,
      name: 'Shipped',
      sort_key: rankKey(9000),
      is_done: true,
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.is_done).toBe(true);
  });

  it('returns 409 for a duplicate id', async () => {
    const projectId = await createProject();
    const id = await insertColumn(projectId);

    const res = await ctx.request(token).post('/api/columns', {
      id,
      project_id: projectId,
      name: 'Duplicate',
      sort_key: rankKey(3000),
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 when the project does not exist, matching an inaccessible project', async () => {
    const res = await ctx.request(token).post('/api/columns', {
      id: newId(),
      project_id: newId(),
      name: 'Orphan',
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Project not found');
  });

  it('returns 422 with details when the body is invalid', async () => {
    const projectId = await createProject();

    const res = await ctx.request(token).post('/api/columns', {
      id: newId(),
      project_id: projectId,
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns 422 for a malformed sort key', async () => {
    const projectId = await createProject();
    for (const bad of ['', 'not a key', 'V0!', 'V00']) {
      const res = await ctx.request(token).post('/api/columns', {
        id: newId(),
        project_id: projectId,
        name: 'Bad key',
        sort_key: bad,
      });
      expect(res.status, bad).toBe(422);

      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details.some((d: { path: string }) => d.path === 'sort_key')).toBe(true);
    }
  });
});

describe('PATCH /api/columns/:id', () => {
  it('requires auth', async () => {
    const res = await ctx.request().patch(`/api/columns/${newId()}`, { name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('renames a column', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Old name' });

    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { name: 'New name' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe(columnId);
    expect(body.name).toBe('New name');
  });

  it('repositions a column', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { sort_key: rankKey(1000) });

    const moved = rankKey(500);
    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { sort_key: moved });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sort_key).toBe(moved);
  });

  it('repositions onto a key a sibling column is holding', async () => {
    const projectId = await createProject();
    const takenKey = rankKey(500);
    await insertColumn(projectId, { name: 'Sitting', sort_key: takenKey });
    const columnId = await insertColumn(projectId, { sort_key: rankKey(1000) });

    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { sort_key: takenKey });
    expect(res.status).toBe(200);
    expect((await res.json()).sort_key > takenKey).toBe(true);
  });

  it('leaves a key free in the project alone, even when a sibling project holds it', async () => {
    const otherProject = await createProject();
    const sharedKey = rankKey(700);
    await insertColumn(otherProject, { name: 'Elsewhere', sort_key: sharedKey });

    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { sort_key: rankKey(1000) });

    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { sort_key: sharedKey });
    expect(res.status).toBe(200);
    expect((await res.json()).sort_key).toBe(sharedKey);
  });

  it('toggles is_done', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { is_done: false });

    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { is_done: true });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.is_done).toBe(true);
  });

  it('returns 422 with details when the body is invalid', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);

    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { name: '   ' });
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 422 for a malformed sort key', async () => {
    const projectId = await createProject();
    for (const bad of ['', 'not a key', 'V0!', 'V00']) {
      const res = await ctx.request(token).post('/api/columns', {
        id: newId(),
        project_id: projectId,
        name: 'Bad key',
        sort_key: bad,
      });
      expect(res.status, bad).toBe(422);

      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details.some((d: { path: string }) => d.path === 'sort_key')).toBe(true);
    }
  });

  it('returns 404 for a nonexistent column', async () => {
    const res = await ctx.request(token).patch(`/api/columns/${newId()}`, { name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/columns/:id', () => {
  it('requires auth', async () => {
    const res = await ctx.request().delete(`/api/columns/${newId()}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a nonexistent column', async () => {
    const res = await ctx.request(token).delete(`/api/columns/${newId()}`);
    expect(res.status).toBe(404);
  });

  it('returns 400 with a plain error body for a malformed move_tasks_to', async () => {
    const res = await ctx.request(token).delete(`/api/columns/${newId()}?move_tasks_to=not-a-uuid`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.data).toBeUndefined();
    expect(body.success).toBeUndefined();
  });

  it('deletes an empty column with 204', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);

    const res = await ctx.request(token).delete(`/api/columns/${columnId}`);
    expect(res.status).toBe(204);

    const row = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', columnId)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('returns 409 when the column has tasks and no move_tasks_to is given', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    const taskId = await insertTask(projectId, columnId, 1000);

    const res = await ctx.request(token).delete(`/api/columns/${columnId}`);
    expect(res.status).toBe(409);

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', columnId)
      .executeTakeFirst();
    expect(column?.id).toBe(columnId);
    const task = await db
      .selectFrom('task')
      .select('id')
      .where('id', '=', taskId)
      .executeTakeFirst();
    expect(task?.id).toBe(taskId);
  });

  it('returns 422 when move_tasks_to equals the deleted column', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    await insertTask(projectId, columnId, 1000);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${columnId}?move_tasks_to=${columnId}`);
    expect(res.status).toBe(422);

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', columnId)
      .executeTakeFirst();
    expect(column?.id).toBe(columnId);
  });

  it('returns 422 when move_tasks_to belongs to another project', async () => {
    const projectId = await createProject();
    const otherProjectId = await createProject();
    const columnId = await insertColumn(projectId);
    const otherColumnId = await insertColumn(otherProjectId);
    await insertTask(projectId, columnId, 1000);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${columnId}?move_tasks_to=${otherColumnId}`);
    expect(res.status).toBe(422);
  });

  it('returns 422 when move_tasks_to does not exist', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    await insertTask(projectId, columnId, 1000);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${columnId}?move_tasks_to=${newId()}`);
    expect(res.status).toBe(422);
  });

  it('moves tasks after the target tasks, preserving relative order', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source', sort_key: rankKey(1000) });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });

    // Insert out of position order to prove ordering follows position, not creation.
    const third = await insertTask(projectId, sourceId, 3000);
    const first = await insertTask(projectId, sourceId, 1000);
    const second = await insertTask(projectId, sourceId, 2000);
    const existingTarget = await insertTask(projectId, targetId, 5000);
    const existingKey = (await tasksInColumn(targetId))[0]!.sort_key;

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${sourceId}?move_tasks_to=${targetId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      moved_tasks: [
        { id: first, column_id: targetId, sort_key: expect.any(String) },
        { id: second, column_id: targetId, sort_key: expect.any(String) },
        { id: third, column_id: targetId, sort_key: expect.any(String) },
      ],
    });

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', sourceId)
      .executeTakeFirst();
    expect(column).toBeUndefined();

    const targetTasks = await tasksInColumn(targetId);
    expect(targetTasks).toEqual([
      {
        id: existingTarget,
        column_id: targetId,
        sort_key: existingKey,
      },
      { id: first, column_id: targetId, sort_key: expect.any(String) },
      { id: second, column_id: targetId, sort_key: expect.any(String) },
      { id: third, column_id: targetId, sort_key: expect.any(String) },
    ]);
  });

  it('counts and relocates archived tasks instead of cascade-deleting them', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Only archived' });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    const taskId = await insertTask(projectId, sourceId, 1000);
    expect((await ctx.request(token).post(`/api/tasks/${taskId}/archive`)).status).toBe(200);

    const refused = await ctx.request(token).delete(`/api/columns/${sourceId}`);
    expect(refused.status).toBe(409);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${sourceId}?move_tasks_to=${targetId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).moved_tasks).toEqual([
      { id: taskId, column_id: targetId, sort_key: expect.any(String) },
    ]);

    const archived = await ctx.request(token).get(`/api/projects/${projectId}/archived-tasks`);
    expect(((await archived.json()) as { tasks: Array<Record<string, unknown>> }).tasks).toEqual([
      expect.objectContaining({ id: taskId, column_id: targetId }),
    ]);
  });

  it('logs a column change on each moved task, naming the column it lost', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Vanishing', sort_key: rankKey(1000) });
    const targetId = await insertColumn(projectId, { name: 'Survivor', sort_key: rankKey(2000) });
    const taskId = await insertTask(projectId, sourceId, 1000);
    const settled = await insertTask(projectId, targetId, 500);
    const emptyId = await insertColumn(projectId, {
      name: 'Nothing here',
      sort_key: rankKey(3000),
    });

    expect(
      (await ctx.request(token).delete(`/api/columns/${emptyId}?move_tasks_to=${targetId}`)).status
    ).toBe(204);
    expect(await activityOf(taskId)).toEqual([]);
    expect(await activityOf(settled)).toEqual([]);

    expect(
      (await ctx.request(token).delete(`/api/columns/${sourceId}?move_tasks_to=${targetId}`)).status
    ).toBe(200);

    expect(await activityOf(taskId)).toEqual([
      expect.objectContaining({
        kind: 'column_changed',
        actor_user_id: userId,
        old_value: { id: sourceId, name: 'Vanishing' },
        new_value: { id: targetId, name: 'Survivor' },
      }),
    ]);
    expect(await activityOf(settled)).toEqual([]);
  });

  it('starts positions at 1000 when the target column is empty', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Empty target', sort_key: key2000 });

    const a = await insertTask(projectId, sourceId, 1000);
    const b = await insertTask(projectId, sourceId, 2000);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${sourceId}?move_tasks_to=${targetId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.moved_tasks).toEqual([
      { id: a, column_id: targetId, sort_key: expect.any(String) },
      { id: b, column_id: targetId, sort_key: expect.any(String) },
    ]);
  });
});

describe('POST /api/columns/:id/move-tasks', () => {
  it('requires auth', async () => {
    const res = await ctx.request().post(`/api/columns/${newId()}/move-tasks`, {
      target_column_id: newId(),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 with a plain error body for a malformed column id', async () => {
    const res = await ctx
      .request(token)
      .post('/api/columns/not-a-uuid/move-tasks', { target_column_id: newId() });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
    expect(body.details).toBeUndefined();
  });

  it('returns 404 for an unknown column and for another user’s column', async () => {
    const unknown = await ctx
      .request(token)
      .post(`/api/columns/${newId()}/move-tasks`, { target_column_id: newId() });
    expect(unknown.status).toBe(404);

    const stranger = await ctx.createUser('columns-stranger');
    const strangerProject = newId();
    const created = await ctx
      .request(stranger.token)
      .post('/api/projects', { id: strangerProject, name: 'not yours' });
    expect(created.status).toBe(201);
    const strangerColumns = (
      (await created.json()) as { columns: Array<{ id: string }> }
    ).columns.map((c) => c.id);

    const res = await ctx.request(token).post(`/api/columns/${strangerColumns[0]}/move-tasks`, {
      target_column_id: strangerColumns[1],
    });
    expect(res.status).toBe(404);

    await ctx.request(stranger.token).delete(`/api/projects/${strangerProject}`);
  });

  it('returns 422 when the target is the source column', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    await insertTask(projectId, columnId, 1000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/move-tasks`, { target_column_id: columnId });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('target_column_id');
    expect(body.error).not.toContain('move_tasks_to');
  });

  it('returns 422 when the target does not exist', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/move-tasks`, { target_column_id: newId() });
    expect(res.status).toBe(422);
  });

  it('returns 422 when the target belongs to another project', async () => {
    const projectId = await createProject();
    const otherProjectId = await createProject();
    const columnId = await insertColumn(projectId);
    const otherColumnId = await insertColumn(otherProjectId);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/move-tasks`, { target_column_id: otherColumnId });
    expect(res.status).toBe(422);
  });

  it('returns 422 with details for a missing or non-uuid target_column_id', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);

    const missing = await ctx.request(token).post(`/api/columns/${columnId}/move-tasks`, {});
    expect(missing.status).toBe(422);
    const missingBody = await missing.json();
    expect(missingBody.error).toBe('Validation failed');
    expect(Array.isArray(missingBody.details)).toBe(true);

    const malformed = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/move-tasks`, { target_column_id: 'nope' });
    expect(malformed.status).toBe(422);
    expect((await malformed.json()).error).toBe('Validation failed');
  });
  it('appends the tasks after the target’s own, preserving relative order', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source', sort_key: rankKey(1000) });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });

    const second = await insertTask(projectId, sourceId, 2000);
    const first = await insertTask(projectId, sourceId, 1000);
    const existingTarget = await insertTask(projectId, targetId, 5000);
    const existingKey = (await tasksInColumn(targetId))[0]!.sort_key;

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      moved_tasks: [
        { id: first, column_id: targetId, sort_key: expect.any(String) },
        { id: second, column_id: targetId, sort_key: expect.any(String) },
      ],
    });

    expect(await tasksInColumn(targetId)).toEqual([
      {
        id: existingTarget,
        column_id: targetId,
        sort_key: existingKey,
      },
      { id: first, column_id: targetId, sort_key: expect.any(String) },
      { id: second, column_id: targetId, sort_key: expect.any(String) },
    ]);
  });

  it('bumps column_since on each moved task', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source', sort_key: rankKey(1000) });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    const taskId = await insertTask(projectId, sourceId, 1000);

    const before = await db
      .selectFrom('task')
      .select('column_since')
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);

    const after = await db
      .selectFrom('task')
      .select('column_since')
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    expect(after.column_since.getTime()).toBeGreaterThan(before.column_since.getTime());
  });

  it('keeps the source column, now empty', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    await insertTask(projectId, sourceId, 1000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', sourceId)
      .executeTakeFirst();
    expect(column?.id).toBe(sourceId);
    expect(await tasksInColumn(sourceId)).toEqual([]);
  });

  it('logs a column change on each moved task', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Leaving', sort_key: rankKey(1000) });
    const targetId = await insertColumn(projectId, { name: 'Arriving', sort_key: rankKey(2000) });
    const taskId = await insertTask(projectId, sourceId, 1000);
    const settled = await insertTask(projectId, targetId, 500);

    expect(
      (
        await ctx
          .request(token)
          .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId })
      ).status
    ).toBe(200);

    expect(await activityOf(taskId)).toEqual([
      expect.objectContaining({
        kind: 'column_changed',
        actor_user_id: userId,
        old_value: { id: sourceId, name: 'Leaving' },
        new_value: { id: targetId, name: 'Arriving' },
      }),
    ]);
    expect(await activityOf(settled)).toEqual([]);
  });

  it('returns an empty moved_tasks for an empty source column and leaves the target alone', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Nothing' });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    const settled = await insertTask(projectId, targetId, 1000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved_tasks: [] });

    expect(await tasksInColumn(targetId)).toEqual([
      { id: settled, column_id: targetId, sort_key: expect.any(String) },
    ]);
  });
  it('starts positions at 1000 when the target column is empty', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Empty target', sort_key: key2000 });
    const a = await insertTask(projectId, sourceId, 1000);
    const b = await insertTask(projectId, sourceId, 2000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);
    expect((await res.json()).moved_tasks).toEqual([
      { id: a, column_id: targetId, sort_key: expect.any(String) },
      { id: b, column_id: targetId, sort_key: expect.any(String) },
    ]);
  });

  it('leaves archived tasks in the source column', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    const archivedId = await insertTask(projectId, sourceId, 1000);
    const liveId = await insertTask(projectId, sourceId, 2000);
    expect((await ctx.request(token).post(`/api/tasks/${archivedId}/archive`)).status).toBe(200);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);
    expect((await res.json()).moved_tasks).toEqual([
      { id: liveId, column_id: targetId, sort_key: expect.any(String) },
    ]);

    expect(await tasksInColumn(sourceId)).toEqual([
      { id: archivedId, column_id: sourceId, sort_key: expect.any(String) },
    ]);
    const archived = await ctx.request(token).get(`/api/projects/${projectId}/archived-tasks`);
    expect(((await archived.json()) as { tasks: Array<Record<string, unknown>> }).tasks).toEqual([
      expect.objectContaining({ id: archivedId, column_id: sourceId }),
    ]);
  });

  it('leaves updated_at untouched on the tasks it moves', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    const taskId = await insertTask(projectId, sourceId, 1000);
    const before = await updatedAt(taskId);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);
    expect(await updatedAt(taskId)).toBe(before);
  });

  it('appends past an archived task holding the highest position in the target', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Target', sort_key: rankKey(2000) });
    const highArchived = await insertTask(projectId, targetId, 9000);
    expect((await ctx.request(token).post(`/api/tasks/${highArchived}/archive`)).status).toBe(200);
    const moving = await insertTask(projectId, sourceId, 1000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
    expect(res.status).toBe(200);
    expect((await res.json()).moved_tasks).toEqual([
      { id: moving, column_id: targetId, sort_key: expect.any(String) },
    ]);
  });
});

describe('POST /api/columns/:id/archive-tasks', () => {
  async function archivedIds(projectId: string): Promise<string[]> {
    const res = await ctx.request(token).get(`/api/projects/${projectId}/archived-tasks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ id: string }> };
    return body.tasks.map((task) => task.id);
  }

  it('requires auth', async () => {
    const res = await ctx.request().post(`/api/columns/${newId()}/archive-tasks`);
    expect(res.status).toBe(401);
  });

  it('returns 400 for a malformed column id and 404 for an unknown one', async () => {
    const malformed = await ctx.request(token).post('/api/columns/not-a-uuid/archive-tasks');
    expect(malformed.status).toBe(400);

    const unknown = await ctx.request(token).post(`/api/columns/${newId()}/archive-tasks`);
    expect(unknown.status).toBe(404);
  });

  it('returns 404 for a column in another user’s project', async () => {
    const stranger = await ctx.createUser('columns-stranger-archive');
    const strangerProject = newId();
    const created = await ctx
      .request(stranger.token)
      .post('/api/projects', { id: strangerProject, name: 'not yours either' });
    expect(created.status).toBe(201);
    const columnId = ((await created.json()) as { columns: Array<{ id: string }> }).columns[0].id;

    const res = await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`);
    expect(res.status).toBe(404);

    await ctx.request(stranger.token).delete(`/api/projects/${strangerProject}`);
  });

  it('archives every live task, keeps the column, and logs one entry per card', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Done' });
    const otherId = await insertColumn(projectId, { name: 'Todo', sort_key: rankKey(2000) });
    const a = await insertTask(projectId, columnId, 1000);
    const b = await insertTask(projectId, columnId, 2000);
    const untouched = await insertTask(projectId, otherId, 1000);

    const res = await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<Record<string, unknown>> };
    expect(body.tasks).toEqual([
      expect.objectContaining({ id: a, column_id: columnId, title: 'Task' }),
      expect.objectContaining({ id: b, column_id: columnId }),
    ]);
    for (const task of body.tasks) {
      expect(typeof task.archived_at).toBe('string');
      expect(task).toHaveProperty('label_ids');
      expect(task).toHaveProperty('blocker_ids');
    }

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', columnId)
      .executeTakeFirst();
    expect(column?.id).toBe(columnId);

    for (const id of [a, b]) {
      expect(await activityOf(id)).toEqual([
        expect.objectContaining({ kind: 'archived', actor_user_id: userId }),
      ]);
    }
    expect(await activityOf(untouched)).toEqual([]);
    const stillThere = await db
      .selectFrom('task')
      .select('archived_at')
      .where('id', '=', untouched)
      .executeTakeFirst();
    expect(stillThere?.archived_at).toBeNull();
  });

  it('drops the tasks from the board payload and the project counts', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Done' });
    await insertTask(projectId, columnId, 1000);
    await insertTask(projectId, columnId, 2000);

    expect((await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`)).status).toBe(
      200
    );

    const board = await ctx.request(token).get(`/api/projects/${projectId}`);
    expect(((await board.json()) as { tasks: unknown[] }).tasks).toEqual([]);

    const list = await ctx.request(token).get('/api/projects');
    const project = (
      (await list.json()) as {
        projects: Array<{ id: string; open_task_count: number; done_task_count: number }>;
      }
    ).projects.find((p) => p.id === projectId);
    expect(project?.open_task_count).toBe(0);
    expect(project?.done_task_count).toBe(0);
  });

  it('keeps an already archived task’s stamp and leaves it out of the response', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Done' });
    const early = await insertTask(projectId, columnId, 1000);
    const late = await insertTask(projectId, columnId, 2000);
    expect((await ctx.request(token).post(`/api/tasks/${early}/archive`)).status).toBe(200);
    const before = await db
      .selectFrom('task')
      .select('archived_at')
      .where('id', '=', early)
      .executeTakeFirstOrThrow();

    const res = await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { tasks: Array<{ id: string }> }).tasks.map((t) => t.id);
    expect(ids).toEqual([late]);

    const after = await db
      .selectFrom('task')
      .select('archived_at')
      .where('id', '=', early)
      .executeTakeFirstOrThrow();
    expect(after.archived_at?.toISOString()).toBe(before.archived_at?.toISOString());
  });

  it('is a no-op on a second call', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Done' });
    const taskId = await insertTask(projectId, columnId, 1000);

    expect((await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`)).status).toBe(
      200
    );
    const second = await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ tasks: [] });
    expect(await activityOf(taskId)).toHaveLength(1);
  });

  it('takes the archived cards out of the blocker lists of the tasks they blocked', async () => {
    const projectId = await createProject();
    const doneId = await insertColumn(projectId, { name: 'Done' });
    const todoId = await insertColumn(projectId, { name: 'Todo', sort_key: rankKey(2000) });
    const blockerId = await insertTask(projectId, doneId, 1000);
    const blockedId = await insertTask(projectId, todoId, 1000);
    expect(
      (
        await ctx
          .request(token)
          .post(`/api/tasks/${blockedId}/blockers`, { blocker_task_id: blockerId })
      ).status
    ).toBe(204);

    expect((await ctx.request(token).post(`/api/columns/${doneId}/archive-tasks`)).status).toBe(
      200
    );

    const board = await ctx.request(token).get(`/api/projects/${projectId}`);
    const tasks = ((await board.json()) as { tasks: Array<{ id: string; blocker_ids: string[] }> })
      .tasks;
    expect(tasks).toEqual([expect.objectContaining({ id: blockedId, blocker_ids: [] })]);
  });

  it('lists everything it archived in the project archive, in the order it returned them', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Done' });
    const inBoardOrder = [];
    for (const position of [1000, 2000, 3000, 4000]) {
      inBoardOrder.push(await insertTask(projectId, columnId, position));
    }

    const res = await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`);
    expect(res.status).toBe(200);
    const returned = ((await res.json()) as { tasks: Array<{ id: string }> }).tasks.map(
      (t) => t.id
    );
    expect(returned).toEqual(inBoardOrder);
    expect(await archivedIds(projectId)).toEqual(returned);
  });

  it('leaves updated_at untouched on the cards it archives', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId, { name: 'Done' });
    const taskId = await insertTask(projectId, columnId, 1000);
    const before = await updatedAt(taskId);

    const res = await ctx.request(token).post(`/api/columns/${columnId}/archive-tasks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tasks: Array<{ updated_at: string }> };
    expect(body.tasks[0]?.updated_at).toBe(before);
    expect(await updatedAt(taskId)).toBe(before);
  });
});

describe('POST /api/columns/:id/reorder', () => {
  it('requires auth', async () => {
    const res = await ctx
      .request()
      .post(`/api/columns/${newId()}/reorder`, { task_ids: [newId()] });
    expect(res.status).toBe(401);
  });

  it('returns 400 with a plain error body for a malformed column id', async () => {
    const res = await ctx.request(token).post('/api/columns/not-a-uuid/reorder', {
      task_ids: [newId()],
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown column and for another user’s column', async () => {
    const res = await ctx.request(token).post(`/api/columns/${newId()}/reorder`, {
      task_ids: [newId()],
    });
    expect(res.status).toBe(404);
  });

  // The id check is a read, so the interleave has to be forced rather than raced:
  // a held row lock lets the request validate, then stall on the write while the
  // card moves away.
  it('leaves a card that moved to another column mid-reorder alone', async () => {
    const projectId = await createProject();
    const source = await insertColumn(projectId);
    const destination = await insertColumn(projectId, { sort_key: rankKey(2000) });
    const stays = await insertTask(projectId, source, 1000);
    const leaves = await insertTask(projectId, source, 2000);

    let releaseHold!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const mover = db.transaction().execute(async (trx) => {
      await trx.selectFrom('task').select('id').where('id', '=', leaves).forUpdate().execute();
      await held;
      await trx
        .updateTable('task')
        .set({ column_id: destination, sort_key: rankKey(7000) })
        .where('id', '=', leaves)
        .execute();
    });

    const reordering = ctx
      .request(token)
      .post(`/api/columns/${source}/reorder`, { task_ids: [leaves, stays] });
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseHold();
    await mover;

    expect((await reordering).status).toBe(200);

    const moved = await db
      .selectFrom('task')
      .select(['column_id', 'sort_key'])
      .where('id', '=', leaves)
      .executeTakeFirstOrThrow();
    expect(moved.column_id).toBe(destination);
    expect(moved.sort_key).toBeTruthy();
  });
  it('re-stamps evenly spaced positions in the given order', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    const third = await insertTask(projectId, columnId, 3000);
    const first = await insertTask(projectId, columnId, 1000);
    const second = await insertTask(projectId, columnId, 2000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [first, second, third] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      moved_tasks: [
        { id: first, column_id: columnId, sort_key: expect.any(String) },
        { id: second, column_id: columnId, sort_key: expect.any(String) },
        { id: third, column_id: columnId, sort_key: expect.any(String) },
      ],
    });

    expect(await tasksInColumn(columnId)).toEqual([
      { id: first, column_id: columnId, sort_key: expect.any(String) },
      { id: second, column_id: columnId, sort_key: expect.any(String) },
      { id: third, column_id: columnId, sort_key: expect.any(String) },
    ]);
  });

  it('leaves updated_at and column_since untouched', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    const a = await insertTask(projectId, columnId, 1000);
    const b = await insertTask(projectId, columnId, 2000);
    const beforeUpdatedAt = await updatedAt(a);
    const beforeColumnSince = (
      await db
        .selectFrom('task')
        .select('column_since')
        .where('id', '=', a)
        .executeTakeFirstOrThrow()
    ).column_since.toISOString();

    const res = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [b, a] });
    expect(res.status).toBe(200);

    expect(await updatedAt(a)).toBe(beforeUpdatedAt);
    const afterColumnSince = (
      await db
        .selectFrom('task')
        .select('column_since')
        .where('id', '=', a)
        .executeTakeFirstOrThrow()
    ).column_since.toISOString();
    expect(afterColumnSince).toBe(beforeColumnSince);
  });

  it('returns 422 when a task id is not an unarchived task in the column', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    const otherColumnId = await insertColumn(projectId, { sort_key: rankKey(2000) });
    const inColumn = await insertTask(projectId, columnId, 1000);
    const elsewhere = await insertTask(projectId, otherColumnId, 1000);

    const foreign = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [inColumn, elsewhere] });
    expect(foreign.status).toBe(422);

    const bogus = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [inColumn, newId()] });
    expect(bogus.status).toBe(422);
  });

  it('returns 422 for duplicate task ids', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);
    const only = await insertTask(projectId, columnId, 1000);

    const res = await ctx
      .request(token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [only, only] });
    expect(res.status).toBe(422);
  });
});
