import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import {
  type BoardColumnPayload,
  type BoardTaskPayload,
  deleteProjects,
  insertLabel,
  insertTask,
  insertTaskImage,
} from '../projects/helpers';

interface DuplicatedColumn {
  column: BoardColumnPayload & { project_id: string; created_at: string };
  tasks: BoardTaskPayload[];
}

describe('POST /api/columns/:id/duplicate', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  async function createProject(name = 'column duplicate'): Promise<string> {
    const projectId = newId();
    projectIds.push(projectId);
    const res = await ctx.request(owner.token).post('/api/projects', { id: projectId, name });
    expect(res.status).toBe(201);
    const shared = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
    expect(shared.status).toBe(204);
    return projectId;
  }

  async function createColumn(
    projectId: string,
    opts: { name?: string; position?: number; isDone?: boolean } = {}
  ): Promise<string> {
    const id = newId();
    await db
      .insertInto('board_column')
      .values({
        id,
        project_id: projectId,
        name: opts.name ?? 'Backlog',
        position: opts.position ?? 1000,
        is_done: opts.isDone ?? false,
      })
      .execute();
    return id;
  }

  beforeAll(async () => {
    owner = await ctx.createUser('column-duplicate');
    member = await ctx.createUser('column-duplicate-member');
    outsider = await ctx.createUser('column-duplicate-outsider');
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      const imageRows = await db
        .selectFrom('task_attachment')
        .innerJoin('task', 'task.id', 'task_attachment.task_id')
        .select('task_attachment.image_storage_key as storage_key')
        .where('task_attachment.kind', '=', 'image')
        .where('task.project_id', 'in', projectIds)
        .execute();
      await Promise.all(imageRows.map((row) => storage.delete(row.storage_key)));
    }
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  it('requires auth', async () => {
    const res = await ctx
      .request()
      .post(`/api/columns/${newId()}/duplicate`, { id: newId(), position: 1500 });
    expect(res.status).toBe(401);
  });

  it('copies the column, its live cards and only the edges inside it', async () => {
    const projectId = await createProject();
    const sourceColumnId = await createColumn(projectId, { name: 'Doing', isDone: true });
    const otherColumnId = await createColumn(projectId, { name: 'Elsewhere', position: 3000 });
    const labelId = await insertLabel({ projectId, name: 'art', color: '#123abc' });

    const aId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'A',
      position: 100,
    });
    const bId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'B',
      position: 200,
    });
    const cId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'C',
      position: 300,
    });
    const shelvedId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'Shelved',
      position: 400,
    });
    const outsideId = await insertTask({
      projectId,
      columnId: otherColumnId,
      title: 'Outside',
      position: 1000,
    });

    const cover = await insertTaskImage({ taskId: aId, filename: 'cover.png', isCover: true });
    await storage.put(cover.storageKey, Buffer.from('cover'), 'image/png');
    await db.insertInto('task_label').values({ task_id: aId, label_id: labelId }).execute();
    await db.insertInto('task_assignee').values({ task_id: aId, user_id: member.id }).execute();
    await db
      .insertInto('task_dependency')
      .values([
        { blocker_task_id: aId, blocked_task_id: bId },
        { blocker_task_id: outsideId, blocked_task_id: aId },
      ])
      .execute();
    expect((await ctx.request(owner.token).post(`/api/tasks/${shelvedId}/archive`)).status).toBe(
      200
    );

    const newColumnId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/columns/${sourceColumnId}/duplicate`, { id: newColumnId, position: 1500 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DuplicatedColumn;

    expect(body.column).toMatchObject({
      id: newColumnId,
      project_id: projectId,
      name: 'Doing',
      position: 1500,
      is_done: true,
    });

    expect(body.tasks.map((task) => task.title)).toEqual(['A', 'B', 'C']);
    expect(body.tasks.map((task) => task.position)).toEqual([100, 200, 300]);
    expect(body.tasks.every((task) => task.column_id === newColumnId)).toBe(true);
    const sourceIds = new Set([aId, bId, cId, shelvedId]);
    expect(body.tasks.some((task) => sourceIds.has(task.id))).toBe(false);

    const [copyA, copyB, copyC] = body.tasks;
    expect(copyA).toMatchObject({ label_ids: [labelId], assignee_ids: [member.id] });
    expect(copyA!.blocker_ids).toEqual([]);
    expect(copyB!.blocker_ids).toEqual([copyA!.id]);
    expect(copyC!.blocker_ids).toEqual([]);

    const copiedCover = await db
      .selectFrom('task_attachment')
      .select(['id', 'filename', 'is_cover'])
      .where('task_id', '=', copyA!.id)
      .where('kind', '=', 'image')
      .executeTakeFirstOrThrow();
    expect(copiedCover).toMatchObject({ filename: 'cover.png', is_cover: true });
    expect(copyA!.cover_image_url).toBe(`/api/images/${copiedCover.id}`);

    const stillInSource = await db
      .selectFrom('task')
      .select('id')
      .where('column_id', '=', sourceColumnId)
      .execute();
    expect(stillInSource.map((row) => row.id).sort()).toEqual([aId, bId, cId, shelvedId].sort());

    const archivedInCopy = await db
      .selectFrom('task')
      .select('id')
      .where('column_id', '=', newColumnId)
      .where('archived_at', 'is not', null)
      .execute();
    expect(archivedInCopy).toEqual([]);
  });

  it('duplicates an empty column', async () => {
    const projectId = await createProject('empty column duplicate');
    const sourceColumnId = await createColumn(projectId, { name: 'Empty' });

    const newColumnId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/columns/${sourceColumnId}/duplicate`, { id: newColumnId, position: 2500 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DuplicatedColumn;
    expect(body.tasks).toEqual([]);

    const row = await db
      .selectFrom('board_column')
      .select(['id', 'name', 'position'])
      .where('id', '=', newColumnId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ name: 'Empty', position: 2500 });
  });

  it('returns 409 for a duplicate column id', async () => {
    const projectId = await createProject('column duplicate conflict');
    const sourceColumnId = await createColumn(projectId);

    const res = await ctx
      .request(owner.token)
      .post(`/api/columns/${sourceColumnId}/duplicate`, { id: sourceColumnId, position: 1500 });
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown column and for another user’s column', async () => {
    const projectId = await createProject('column duplicate access');
    const sourceColumnId = await createColumn(projectId);

    const unknown = await ctx
      .request(owner.token)
      .post(`/api/columns/${newId()}/duplicate`, { id: newId(), position: 1500 });
    expect(unknown.status).toBe(404);

    const foreignColumnId = newId();
    const foreign = await ctx
      .request(outsider.token)
      .post(`/api/columns/${sourceColumnId}/duplicate`, { id: foreignColumnId, position: 1500 });
    expect(foreign.status).toBe(404);

    const columns = await db
      .selectFrom('board_column')
      .select('id')
      .where('project_id', '=', projectId)
      .execute();
    expect(columns.map((row) => row.id)).toContain(sourceColumnId);
    expect(columns.map((row) => row.id)).not.toContain(foreignColumnId);
  });

  it('returns 400 for a non-uuid path param and 422 for a missing position', async () => {
    const projectId = await createProject('column duplicate validation');
    const sourceColumnId = await createColumn(projectId);

    const badParam = await ctx
      .request(owner.token)
      .post('/api/columns/not-a-uuid/duplicate', { id: newId(), position: 1500 });
    expect(badParam.status).toBe(400);

    const badBody = await ctx
      .request(owner.token)
      .post(`/api/columns/${sourceColumnId}/duplicate`, { id: newId() });
    expect(badBody.status).toBe(422);
  });

  it('rolls back the new column when an image object is missing from storage', async () => {
    const projectId = await createProject('column duplicate rollback');
    const sourceColumnId = await createColumn(projectId);
    const taskId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'Task with missing image object',
      position: 1000,
    });
    await insertTaskImage({ taskId });

    const newColumnId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/columns/${sourceColumnId}/duplicate`, { id: newColumnId, position: 1500 });
    expect(res.status).toBe(500);

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', newColumnId)
      .executeTakeFirst();
    expect(column).toBeUndefined();
  });

  it('reclaims already-copied image objects when a later copy fails', async () => {
    const projectId = await createProject('column duplicate orphan');
    const sourceColumnId = await createColumn(projectId);
    const firstTaskId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'First',
      position: 1000,
    });
    const secondTaskId = await insertTask({
      projectId,
      columnId: sourceColumnId,
      title: 'Second',
      position: 2000,
    });
    const first = await insertTaskImage({ taskId: firstTaskId });
    const second = await insertTaskImage({ taskId: secondTaskId });
    await storage.put(first.storageKey, Buffer.from('one!'), 'image/png');
    await storage.put(second.storageKey, Buffer.from('two!'), 'image/png');

    const destKeys: string[] = [];
    const realCopy = storage.copy.bind(storage);
    const copySpy = vi
      .spyOn(storage, 'copy')
      .mockImplementation(async (sourceKey: string, destKey: string) => {
        if (destKeys.length > 0) {
          throw new Error('storage unavailable');
        }
        destKeys.push(destKey);
        await realCopy(sourceKey, destKey);
      });

    const newColumnId = newId();
    try {
      const res = await ctx
        .request(owner.token)
        .post(`/api/columns/${sourceColumnId}/duplicate`, { id: newColumnId, position: 1500 });
      expect(res.status).toBe(500);
    } finally {
      copySpy.mockRestore();
    }

    expect(destKeys).toHaveLength(1);
    expect(await storage.get(destKeys[0])).toBeNull();

    const column = await db
      .selectFrom('board_column')
      .select('id')
      .where('id', '=', newColumnId)
      .executeTakeFirst();
    expect(column).toBeUndefined();
  });
});
