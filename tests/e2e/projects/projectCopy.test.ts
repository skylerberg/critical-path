import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import {
  BoardPayloadBody,
  deleteProjects,
  insertLabel,
  insertTask,
  insertTaskComment,
  insertTaskImage,
} from './helpers';

interface TiptapImageNode {
  type: string;
  attrs?: { src?: string };
  content?: TiptapImageNode[];
}

describe('POST /api/projects with source_project_id', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let user: TestUser;

  beforeAll(async () => {
    user = await ctx.createUser('project-copy');
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

  it('deep-copies structure with remapped ids, rewritten image srcs, and no assignees', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    const sourceRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: sourceId, name: 'Copy source', description: 'Source desc' });
    expect(sourceRes.status).toBe(201);
    const source = (await sourceRes.json()) as BoardPayloadBody;
    const backlog = source.columns.find((c) => c.name === 'Backlog')!;
    const done = source.columns.find((c) => c.name === 'Done')!;

    const patchRes = await ctx.request(user.token).patch(`/api/projects/${sourceId}`, {
      archived_at: '2026-03-01T00:00:00.000Z',
    });
    expect(patchRes.status).toBe(200);

    const labelId = await insertLabel({ projectId: sourceId, name: 'art', color: '#123abc' });

    const imageId = newId();
    const imageBytes = Buffer.from('png-bytes');
    const description = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'design notes' }] },
        { type: 'image', attrs: { src: `/api/images/${imageId}` } },
      ],
    };
    const blockerTaskId = await insertTask({
      projectId: sourceId,
      columnId: backlog.id,
      title: 'Draw art',
      position: 1500,
      description,
      dueDate: '2026-08-03',
    });
    const blockedTaskId = await insertTask({
      projectId: sourceId,
      columnId: done.id,
      title: 'Print cards',
      position: 2500,
    });

    const { storageKey } = await insertTaskImage({ taskId: blockerTaskId, imageId, isCover: true });
    await storage.put(storageKey, imageBytes, 'image/png');

    await insertTaskComment({ taskId: blockerTaskId, userId: user.id, text: 'not copied' });

    await db
      .insertInto('task_label')
      .values({ task_id: blockerTaskId, label_id: labelId })
      .execute();
    await db
      .insertInto('task_assignee')
      .values({ task_id: blockerTaskId, user_id: user.id })
      .execute();
    await db
      .insertInto('task_dependency')
      .values({ blocker_task_id: blockerTaskId, blocked_task_id: blockedTaskId })
      .execute();

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: copyId, name: 'Copied project', source_project_id: sourceId });
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()) as BoardPayloadBody;

    expect(copy.project).toMatchObject({
      id: copyId,
      name: 'Copied project',
      description: 'Source desc',
      archived_at: null,
    });

    expect(
      copy.columns.map((c) => ({ name: c.name, position: c.position, is_done: c.is_done }))
    ).toEqual(
      source.columns.map((c) => ({ name: c.name, position: c.position, is_done: c.is_done }))
    );
    const sourceColumnIds = new Set(source.columns.map((c) => c.id));
    for (const column of copy.columns) {
      expect(sourceColumnIds.has(column.id)).toBe(false);
    }

    expect(copy.labels).toHaveLength(1);
    expect(copy.labels[0]).toMatchObject({ name: 'art', color: '#123abc' });
    expect(copy.labels[0].id).not.toBe(labelId);

    expect(copy.tasks).toHaveLength(2);
    const copiedBlocker = copy.tasks.find((t) => t.title === 'Draw art')!;
    const copiedBlocked = copy.tasks.find((t) => t.title === 'Print cards')!;
    expect([copiedBlocker.id, copiedBlocked.id]).not.toContain(blockerTaskId);
    expect([copiedBlocker.id, copiedBlocked.id]).not.toContain(blockedTaskId);

    const copiedBacklog = copy.columns.find((c) => c.name === 'Backlog')!;
    const copiedDone = copy.columns.find((c) => c.name === 'Done')!;
    expect(copiedBlocker).toMatchObject({
      column_id: copiedBacklog.id,
      position: 1500,
      due_date: '2026-08-03',
      label_ids: [copy.labels[0].id],
      assignee_ids: [],
      image_count: 1,
      comment_count: 0,
    });
    expect(copiedBlocked).toMatchObject({
      column_id: copiedDone.id,
      position: 2500,
      due_date: null,
      blocker_ids: [copiedBlocker.id],
      assignee_ids: [],
    });

    const newImageRow = await db
      .selectFrom('task_attachment')
      .select([
        'id',
        'image_storage_key as storage_key',
        'filename',
        'image_content_type as content_type',
        'size_bytes',
        'is_cover',
      ])
      .where('task_id', '=', copiedBlocker.id)
      .where('kind', '=', 'image')
      .executeTakeFirstOrThrow();
    expect(newImageRow.id).not.toBe(imageId);
    expect(newImageRow.storage_key).not.toBe(storageKey);
    expect(newImageRow.filename).toBe('test.png');
    expect(newImageRow.is_cover).toBe(true);
    expect(copiedBlocker.cover_image_url).toBe(`/api/images/${newImageRow.id}`);
    expect(copiedBlocked.cover_image_url).toBeNull();

    const copiedDescription = copiedBlocker.description as TiptapImageNode;
    const imageNode = copiedDescription.content!.find((node) => node.type === 'image')!;
    expect(imageNode.attrs!.src).toBe(`/api/images/${newImageRow.id}`);
    const textNode = copiedDescription.content!.find((node) => node.type === 'paragraph')!;
    expect(textNode).toEqual(description.content[0]);

    expect(await storage.get(newImageRow.storage_key)).toEqual(imageBytes);
    expect(await storage.get(storageKey)).toEqual(imageBytes);
  });

  it('rolls back every copied row when the copy fails after the inserts', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    const sourceRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: sourceId, name: 'Broken image source' });
    expect(sourceRes.status).toBe(201);
    const source = (await sourceRes.json()) as BoardPayloadBody;

    const taskId = await insertTask({
      projectId: sourceId,
      columnId: source.columns[0].id,
      title: 'Task with missing image object',
    });
    await insertTaskImage({ taskId });

    const copyId = newId();
    const res = await ctx
      .request(user.token)
      .post('/api/projects', { id: copyId, name: 'Doomed copy', source_project_id: sourceId });
    expect(res.status).toBe(500);

    const copiedProject = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', copyId)
      .executeTakeFirst();
    expect(copiedProject).toBeUndefined();

    const getRes = await ctx.request(user.token).get(`/api/projects/${copyId}`);
    expect(getRes.status).toBe(404);
  });

  it('starts each copied task’s activity log at a single created entry', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    const sourceRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: sourceId, name: 'History source' });
    expect(sourceRes.status).toBe(201);
    const source = (await sourceRes.json()) as BoardPayloadBody;

    const taskId = newId();
    expect(
      (
        await ctx.request(user.token).post('/api/tasks', {
          id: taskId,
          project_id: sourceId,
          column_id: source.columns[0]!.id,
          title: 'Original',
          position: 1000,
        })
      ).status
    ).toBe(201);
    expect(
      (await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { title: 'Renamed' })).status
    ).toBe(200);

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: copyId, name: 'Copy', source_project_id: sourceId });
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()) as BoardPayloadBody;

    const activityRes = await ctx
      .request(user.token)
      .get(`/api/tasks/${copy.tasks[0]!.id}/activity`);
    expect(activityRes.status).toBe(200);
    const { activity } = (await activityRes.json()) as {
      activity: Array<{ kind: string; actor_user_id: string; new_value: unknown }>;
    };
    expect(activity).toEqual([
      expect.objectContaining({
        kind: 'created',
        actor_user_id: user.id,
        new_value: { text: 'Renamed' },
      }),
    ]);
  });

  it('never inherits the source board’s public flag', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    expect(
      (await ctx.request(user.token).post('/api/projects', { id: sourceId, name: 'Published' }))
        .status
    ).toBe(201);
    expect(
      (await ctx.request(user.token).patch(`/api/projects/${sourceId}`, { is_public: true })).status
    ).toBe(200);

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: copyId, name: 'Copy', source_project_id: sourceId });
    expect(copyRes.status).toBe(201);
    expect(((await copyRes.json()) as BoardPayloadBody).project).toMatchObject({
      is_public: false,
    });

    const publicRes = await ctx.request().get(`/api/public/projects/${copyId}/board`);
    expect(publicRes.status).toBe(404);
  });

  // A copy lands beside its source in the same sidebar, which is exactly when the
  // two boards must not look alike.
  it('never inherits the source board’s accent colour', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    expect(
      (await ctx.request(user.token).post('/api/projects', { id: sourceId, name: 'Coloured' }))
        .status
    ).toBe(201);
    expect(
      (await ctx.request(user.token).patch(`/api/projects/${sourceId}`, { color: 'emerald' }))
        .status
    ).toBe(200);

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: copyId, name: 'Copy', source_project_id: sourceId });
    expect(copyRes.status).toBe(201);
    expect(((await copyRes.json()) as BoardPayloadBody).project.color).toBeNull();

    const sourceBoard = await ctx.request(user.token).get(`/api/projects/${sourceId}`);
    expect(((await sourceBoard.json()) as BoardPayloadBody).project.color).toBe('emerald');
  });

  it('copies neither archived tasks nor their labels, images or dependency edges', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    const sourceRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: sourceId, name: 'Archive source' });
    expect(sourceRes.status).toBe(201);
    const source = (await sourceRes.json()) as BoardPayloadBody;
    const backlog = source.columns.find((c) => c.name === 'Backlog')!;

    const labelId = await insertLabel({ projectId: sourceId, name: 'shelved', color: '#445566' });
    const keptId = await insertTask({
      projectId: sourceId,
      columnId: backlog.id,
      title: 'Kept',
      position: 1000,
    });
    const shelvedId = await insertTask({
      projectId: sourceId,
      columnId: backlog.id,
      title: 'Shelved',
      position: 2000,
    });
    const blockedId = await insertTask({
      projectId: sourceId,
      columnId: backlog.id,
      title: 'Blocked by both',
      position: 3000,
    });
    await db.insertInto('task_label').values({ task_id: shelvedId, label_id: labelId }).execute();
    await insertTaskImage({ taskId: shelvedId });
    await db
      .insertInto('task_dependency')
      .values([
        { blocker_task_id: keptId, blocked_task_id: blockedId },
        { blocker_task_id: shelvedId, blocked_task_id: blockedId },
      ])
      .execute();

    expect((await ctx.request(user.token).post(`/api/tasks/${shelvedId}/archive`)).status).toBe(
      200
    );

    const copyId = newId();
    projectIds.push(copyId);
    const copyRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: copyId, name: 'Archive copy', source_project_id: sourceId });
    expect(copyRes.status).toBe(201);
    const copy = (await copyRes.json()) as BoardPayloadBody;

    expect(copy.tasks.map((t) => t.title).sort()).toEqual(['Blocked by both', 'Kept']);
    const copiedKept = copy.tasks.find((t) => t.title === 'Kept')!;
    const copiedBlocked = copy.tasks.find((t) => t.title === 'Blocked by both')!;
    expect(copiedBlocked.blocker_ids).toEqual([copiedKept.id]);
    expect(copy.tasks.every((t) => t.label_ids.length === 0)).toBe(true);
    expect(copy.tasks.every((t) => t.image_count === 0)).toBe(true);

    const archivedInCopy = await ctx
      .request(user.token)
      .get(`/api/projects/${copyId}/archived-tasks`);
    expect(((await archivedInCopy.json()) as { tasks: unknown[] }).tasks).toEqual([]);
  });

  it('returns 422 when source_project_id does not exist', async () => {
    const res = await ctx.request(user.token).post('/api/projects', {
      id: newId(),
      name: 'Orphan copy',
      source_project_id: newId(),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(typeof body.error).toBe('string');
  });

  it('returns 409 when copying onto an existing project id', async () => {
    const sourceId = newId();
    projectIds.push(sourceId);
    await ctx.request(user.token).post('/api/projects', { id: sourceId, name: 'Copy source' });

    const res = await ctx.request(user.token).post('/api/projects', {
      id: sourceId,
      name: 'Clash',
      source_project_id: sourceId,
    });
    expect(res.status).toBe(409);
  });
});
