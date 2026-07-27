import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import {
  type BoardTaskPayload,
  deleteProjects,
  insertLabel,
  insertTask,
  insertTaskComment,
  insertTaskImage,
} from '../projects/helpers';

interface DescriptionNode {
  type: string;
  attrs?: { src?: string };
  content?: DescriptionNode[];
}

describe('POST /api/tasks/:id/duplicate', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  async function createProject(name = 'duplicate source'): Promise<{
    projectId: string;
    columnId: string;
  }> {
    const projectId = newId();
    projectIds.push(projectId);
    const res = await ctx.request(owner.token).post('/api/projects', { id: projectId, name });
    expect(res.status).toBe(201);
    const { columns } = (await res.json()) as { columns: Array<{ id: string; name: string }> };
    const shared = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
    expect(shared.status).toBe(204);
    return { projectId, columnId: columns[0]!.id };
  }

  beforeAll(async () => {
    owner = await ctx.createUser('task-duplicate');
    member = await ctx.createUser('task-duplicate-member');
    outsider = await ctx.createUser('task-duplicate-outsider');
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      const imageRows = await db
        .selectFrom('task_image')
        .innerJoin('task', 'task.id', 'task_image.task_id')
        .select('task_image.storage_key')
        .where('task.project_id', 'in', projectIds)
        .execute();
      await Promise.all(imageRows.map((row) => storage.delete(row.storage_key)));
    }
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  it('requires auth', async () => {
    const res = await ctx.request().post(`/api/tasks/${newId()}/duplicate`, {
      id: newId(),
      position: 1500,
    });
    expect(res.status).toBe(401);
  });

  it('copies title, description, due date, labels, assignees and images but no edges', async () => {
    const { projectId, columnId } = await createProject();
    const labelId = await insertLabel({ projectId, name: 'art', color: '#123abc' });

    const imageId = newId();
    const description = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'design notes' }] },
        { type: 'image', attrs: { src: `/api/images/${imageId}` } },
      ],
    };
    const sourceId = await insertTask({
      projectId,
      columnId,
      title: 'Draw art',
      position: 1000,
      description,
      dueDate: '2026-08-03',
    });
    const blockerId = await insertTask({ projectId, columnId, title: 'Buy pens', position: 500 });
    const dependentId = await insertTask({
      projectId,
      columnId,
      title: 'Print cards',
      position: 2000,
    });

    const { storageKey } = await insertTaskImage({ taskId: sourceId, imageId });
    const imageBytes = Buffer.from('png-bytes');
    await storage.put(storageKey, imageBytes, 'image/png');

    await insertTaskComment({ taskId: sourceId, userId: owner.id, text: 'not copied' });
    await db.insertInto('task_label').values({ task_id: sourceId, label_id: labelId }).execute();
    await db
      .insertInto('task_assignee')
      .values([
        { task_id: sourceId, user_id: owner.id },
        { task_id: sourceId, user_id: member.id },
      ])
      .execute();
    await db
      .insertInto('task_dependency')
      .values([
        { blocker_task_id: blockerId, blocked_task_id: sourceId },
        { blocker_task_id: sourceId, blocked_task_id: dependentId },
      ])
      .execute();

    const copyId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: copyId, position: 1500 });
    expect(res.status).toBe(201);
    const copy = (await res.json()) as BoardTaskPayload;

    expect(copy).toMatchObject({
      id: copyId,
      column_id: columnId,
      title: 'Draw art',
      position: 1500,
      due_date: '2026-08-03',
      label_ids: [labelId],
      image_count: 1,
      comment_count: 0,
      blocker_ids: [],
    });
    expect([...copy.assignee_ids].sort()).toEqual([owner.id, member.id].sort());

    const newImage = await db
      .selectFrom('task_image')
      .select(['id', 'storage_key', 'filename'])
      .where('task_id', '=', copyId)
      .executeTakeFirstOrThrow();
    expect(newImage.id).not.toBe(imageId);
    expect(newImage.storage_key).not.toBe(storageKey);
    expect(newImage.filename).toBe('test.png');
    expect(await storage.get(newImage.storage_key)).toEqual(imageBytes);
    expect(await storage.get(storageKey)).toEqual(imageBytes);

    const copied = copy.description as DescriptionNode;
    const imageNode = copied.content!.find((node) => node.type === 'image')!;
    expect(imageNode.attrs!.src).toBe(`/api/images/${newImage.id}`);
    expect(copied.content!.find((node) => node.type === 'paragraph')).toEqual(
      description.content[0]
    );

    const edges = await db
      .selectFrom('task_dependency')
      .select(['blocker_task_id', 'blocked_task_id'])
      .where((eb) =>
        eb.or([eb('blocker_task_id', '=', copyId), eb('blocked_task_id', '=', copyId)])
      )
      .execute();
    expect(edges).toEqual([]);

    const dependent = await ctx.request(owner.token).get(`/api/tasks/${dependentId}`);
    expect(((await dependent.json()) as BoardTaskPayload).blocker_ids).toEqual([sourceId]);
  });

  it('carries the cover image over to the copy', async () => {
    const { projectId, columnId } = await createProject('duplicate cover');
    const sourceId = await insertTask({
      projectId,
      columnId,
      title: 'Has a cover',
      position: 1000,
    });
    const plain = await insertTaskImage({ taskId: sourceId, filename: 'plain.png' });
    const cover = await insertTaskImage({
      taskId: sourceId,
      filename: 'cover.png',
      isCover: true,
    });
    await storage.put(plain.storageKey, Buffer.from('plain'), 'image/png');
    await storage.put(cover.storageKey, Buffer.from('cover'), 'image/png');

    const copyId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: copyId, position: 2000 });
    expect(res.status).toBe(201);
    const copy = (await res.json()) as BoardTaskPayload;

    const copiedImages = await db
      .selectFrom('task_image')
      .select(['id', 'filename', 'is_cover'])
      .where('task_id', '=', copyId)
      .execute();
    expect(copiedImages).toHaveLength(2);
    const copiedCover = copiedImages.find((image) => image.is_cover);
    expect(copiedCover?.filename).toBe('cover.png');
    expect(copiedCover?.id).not.toBe(cover.imageId);
    expect(copy.cover_image_url).toBe(`/api/images/${copiedCover!.id}`);

    const sourceCover = await db
      .selectFrom('task_image')
      .select('id')
      .where('task_id', '=', sourceId)
      .where('is_cover', '=', true)
      .executeTakeFirstOrThrow();
    expect(sourceCover.id).toBe(cover.imageId);
  });

  it('starts the copy’s activity log at its own created entry', async () => {
    const { projectId, columnId } = await createProject('duplicate activity');
    const sourceId = newId();
    expect(
      (
        await ctx.request(owner.token).post('/api/tasks', {
          id: sourceId,
          project_id: projectId,
          column_id: columnId,
          title: 'Original',
          position: 1000,
        })
      ).status
    ).toBe(201);
    expect(
      (await ctx.request(owner.token).patch(`/api/tasks/${sourceId}`, { title: 'Renamed' })).status
    ).toBe(200);

    const copyId = newId();
    expect(
      (
        await ctx
          .request(member.token)
          .post(`/api/tasks/${sourceId}/duplicate`, { id: copyId, position: 1500 })
      ).status
    ).toBe(201);

    const activityRes = await ctx.request(owner.token).get(`/api/tasks/${copyId}/activity`);
    expect(activityRes.status).toBe(200);
    const { activity } = (await activityRes.json()) as {
      activity: Array<{ kind: string; actor_user_id: string; new_value: unknown }>;
    };
    expect(activity).toEqual([
      expect.objectContaining({
        kind: 'created',
        actor_user_id: member.id,
        new_value: { text: 'Renamed' },
      }),
    ]);
  });

  it('duplicates an archived task as a live card', async () => {
    const { projectId, columnId } = await createProject('duplicate archived');
    const sourceId = await insertTask({ projectId, columnId, title: 'Shelved', position: 1000 });
    expect((await ctx.request(owner.token).post(`/api/tasks/${sourceId}/archive`)).status).toBe(
      200
    );

    const copyId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: copyId, position: 2000 });
    expect(res.status).toBe(201);

    const detail = await ctx.request(owner.token).get(`/api/tasks/${copyId}`);
    expect(((await detail.json()) as { archived_at: string | null }).archived_at).toBeNull();

    const board = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    const { tasks } = (await board.json()) as { tasks: BoardTaskPayload[] };
    expect(tasks.map((task) => task.id)).toEqual([copyId]);
  });

  it('returns 409 when the supplied id is already in use', async () => {
    const { projectId, columnId } = await createProject('duplicate conflict');
    const sourceId = await insertTask({ projectId, columnId, title: 'Source', position: 1000 });

    const res = await ctx
      .request(owner.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: sourceId, position: 1500 });
    expect(res.status).toBe(409);
  });

  it('returns 404 for an unknown task and for another user’s task', async () => {
    const { projectId, columnId } = await createProject('duplicate access');
    const sourceId = await insertTask({ projectId, columnId, title: 'Private', position: 1000 });

    const unknown = await ctx
      .request(owner.token)
      .post(`/api/tasks/${newId()}/duplicate`, { id: newId(), position: 1500 });
    expect(unknown.status).toBe(404);

    const foreign = await ctx
      .request(outsider.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: newId(), position: 1500 });
    expect(foreign.status).toBe(404);

    const copied = await db
      .selectFrom('task')
      .select('id')
      .where('project_id', '=', projectId)
      .execute();
    expect(copied.map((row) => row.id)).toEqual([sourceId]);
  });

  it('returns 400 for a non-uuid path param and 422 for a missing position', async () => {
    const { projectId, columnId } = await createProject('duplicate validation');
    const sourceId = await insertTask({ projectId, columnId, title: 'Source', position: 1000 });

    const badParam = await ctx
      .request(owner.token)
      .post('/api/tasks/not-a-uuid/duplicate', { id: newId(), position: 1500 });
    expect(badParam.status).toBe(400);

    const badBody = await ctx
      .request(owner.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: newId() });
    expect(badBody.status).toBe(422);
  });

  it('rolls the copy back when an image object is missing from storage', async () => {
    const { projectId, columnId } = await createProject('duplicate rollback');
    const sourceId = await insertTask({
      projectId,
      columnId,
      title: 'Task with missing image object',
      position: 1000,
    });
    await insertTaskImage({ taskId: sourceId });

    const copyId = newId();
    const res = await ctx
      .request(owner.token)
      .post(`/api/tasks/${sourceId}/duplicate`, { id: copyId, position: 1500 });
    expect(res.status).toBe(500);

    const copied = await db
      .selectFrom('task')
      .select('id')
      .where('id', '=', copyId)
      .executeTakeFirst();
    expect(copied).toBeUndefined();
  });
});
