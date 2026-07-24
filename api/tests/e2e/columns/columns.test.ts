import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { db } from '../../../src/db/index';
import { newId, rawJsonWithPosition } from '../../helpers/fixtures';

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
  opts: { name?: string; position?: number; is_done?: boolean } = {}
): Promise<string> {
  const id = newId();
  await db
    .insertInto('board_column')
    .values({
      id,
      project_id: projectId,
      name: opts.name ?? 'Column',
      position: opts.position ?? 1000,
      is_done: opts.is_done ?? false,
    })
    .execute();
  return id;
}

async function insertTask(projectId: string, columnId: string, position: number): Promise<string> {
  const id = newId();
  await db
    .insertInto('task')
    .values({ id, project_id: projectId, column_id: columnId, title: 'Task', position })
    .execute();
  return id;
}

function tasksInColumn(columnId: string) {
  return db
    .selectFrom('task')
    .select(['id', 'column_id', 'position'])
    .where('column_id', '=', columnId)
    .orderBy('position')
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
      position: 1000,
    });
    expect(res.status).toBe(401);
  });

  it('creates a column with is_done defaulting to false', async () => {
    const projectId = await createProject();
    const id = newId();

    const res = await ctx.request(token).post('/api/columns', {
      id,
      project_id: projectId,
      name: 'Review',
      position: 2500,
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body).toEqual({
      id,
      project_id: projectId,
      name: 'Review',
      position: 2500,
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
      position: 9000,
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
      position: 3000,
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 when the project does not exist, matching an inaccessible project', async () => {
    const res = await ctx.request(token).post('/api/columns', {
      id: newId(),
      project_id: newId(),
      name: 'Orphan',
      position: 1000,
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
      position: 1000,
    });
    expect(res.status).toBe(422);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns 422 for a non-finite position', async () => {
    const projectId = await createProject();

    for (const literal of ['1e999', '-1e999']) {
      const raw = rawJsonWithPosition(
        { id: newId(), project_id: projectId, name: 'Non-finite' },
        literal
      );
      const res = await ctx.request(token).sendRawJson('POST', '/api/columns', raw);
      expect(res.status, literal).toBe(422);

      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(body.details.some((d: { path: string }) => d.path === 'position')).toBe(true);
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
    const columnId = await insertColumn(projectId, { position: 1000 });

    const res = await ctx.request(token).patch(`/api/columns/${columnId}`, { position: 500 });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.position).toBe(500);
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

  it('returns 422 for a non-finite position', async () => {
    const projectId = await createProject();
    const columnId = await insertColumn(projectId);

    for (const literal of ['1e999', '-1e999']) {
      const res = await ctx
        .request(token)
        .sendRawJson('PATCH', `/api/columns/${columnId}`, rawJsonWithPosition({}, literal));
      expect(res.status, literal).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
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
    const sourceId = await insertColumn(projectId, { name: 'Source', position: 1000 });
    const targetId = await insertColumn(projectId, { name: 'Target', position: 2000 });

    // Insert out of position order to prove ordering follows position, not creation.
    const third = await insertTask(projectId, sourceId, 3000);
    const first = await insertTask(projectId, sourceId, 1000);
    const second = await insertTask(projectId, sourceId, 2000);
    const existingTarget = await insertTask(projectId, targetId, 5000);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${sourceId}?move_tasks_to=${targetId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      moved_tasks: [
        { id: first, column_id: targetId, position: 6000 },
        { id: second, column_id: targetId, position: 7000 },
        { id: third, column_id: targetId, position: 8000 },
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
      { id: existingTarget, column_id: targetId, position: 5000 },
      { id: first, column_id: targetId, position: 6000 },
      { id: second, column_id: targetId, position: 7000 },
      { id: third, column_id: targetId, position: 8000 },
    ]);
  });

  it('starts positions at 1000 when the target column is empty', async () => {
    const projectId = await createProject();
    const sourceId = await insertColumn(projectId, { name: 'Source' });
    const targetId = await insertColumn(projectId, { name: 'Empty target', position: 2000 });

    const a = await insertTask(projectId, sourceId, 1000);
    const b = await insertTask(projectId, sourceId, 2000);

    const res = await ctx
      .request(token)
      .delete(`/api/columns/${sourceId}?move_tasks_to=${targetId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.moved_tasks).toEqual([
      { id: a, column_id: targetId, position: 1000 },
      { id: b, column_id: targetId, position: 2000 },
    ]);
  });
});
