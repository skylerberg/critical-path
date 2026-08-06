import { promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { imageUploadPath, newId, rankKey } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';
import { projectStorageAllowance } from '../../../src/services/attachments/quota';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

// Covers services/attachments/images.ts, the only writer of kind='image' rows:
// what an upload, a delete, a cover change and a card copy each leave behind,
// and that an image reaches every attachment surface exactly once — one row in
// attachments[], one in the count, one in the export, one set of bytes in the
// quota.
describe('image writes', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  // One account for the file: every test request presents the same source IP, so
  // signups across concurrently running files share one budget.
  let user: Awaited<ReturnType<TestContext['createUser']>>;

  beforeAll(async () => {
    user = await ctx.createUser('mirror');
  });

  async function createTaskFixture(ownerId: string): Promise<{
    projectId: string;
    columnId: string;
    taskId: string;
  }> {
    const projectId = newId();
    const columnId = newId();
    const taskId = newId();

    await db
      .insertInto('project')
      .values({ id: projectId, name: 'image mirror project', created_by: ownerId })
      .execute();
    await db
      .insertInto('board_column')
      .values({ id: columnId, project_id: projectId, name: 'To Do', sort_key: rankKey(1000) })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: projectId,
        column_id: columnId,
        title: 'task',
        sort_key: rankKey(1000),
      })
      .execute();

    createdProjectIds.push(projectId);
    return { projectId, columnId, taskId };
  }

  function imageRows(taskId: string) {
    return db
      .selectFrom('task_attachment')
      .select([
        'id',
        'kind',
        'filename',
        'size_bytes',
        'image_storage_key',
        'image_content_type',
        'is_cover',
      ])
      .where('task_id', '=', taskId)
      .where('kind', '=', 'image')
      .orderBy('created_at')
      .execute();
  }

  afterAll(async () => {
    if (createdProjectIds.length > 0) {
      const rows = await db
        .selectFrom('task_attachment')
        .innerJoin('task', 'task.id', 'task_attachment.task_id')
        .select('task_attachment.image_storage_key as storage_key')
        .where('task_attachment.kind', '=', 'image')
        .where('task.project_id', 'in', createdProjectIds)
        .execute();
      await Promise.all(
        rows.map((row) => fs.rm(path.join(env.storageDiskRoot, row.storage_key), { force: true }))
      );
      await db.deleteFrom('project').where('id', 'in', createdProjectIds).execute();
    }
    await ctx.cleanup();
  });

  it('stores an upload under the client-supplied id, with its sniffed type', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const imageId = newId();

    const res = await ctx
      .request(user.token)
      .postBytes(imageUploadPath(taskId, 'pixel.png', imageId), PNG_1X1);
    expect(res.status).toBe(201);

    const rows = await imageRows(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: imageId,
      kind: 'image',
      filename: 'pixel.png',
      size_bytes: PNG_1X1.length,
      // Sniffed, never taken from the upload's declared type.
      image_content_type: 'image/png',
      is_cover: false,
    });
    // The bytes live under a key of the server's choosing, not the row id.
    expect(rows[0]!.image_storage_key).not.toBe(imageId);
    expect(rows[0]!.image_storage_key).not.toBeNull();

    // File and link columns stay empty, which is what keeps this row off the
    // attachment download route.
    const shape = await db
      .selectFrom('task_attachment')
      .select(['storage_key', 'content_type', 'url', 'unfurl_state'])
      .where('id', '=', imageId)
      .executeTakeFirstOrThrow();
    expect(shape).toEqual({
      storage_key: null,
      content_type: null,
      url: null,
      unfurl_state: null,
    });
  });

  it('removes the row when the image is deleted', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const imageId = newId();

    await ctx.request(user.token).postBytes(imageUploadPath(taskId, 'pixel.png', imageId), PNG_1X1);
    expect(await imageRows(taskId)).toHaveLength(1);

    const res = await ctx.request(user.token).delete(`/api/attachments/${imageId}`);
    expect(res.status).toBe(204);
    expect(await imageRows(taskId)).toHaveLength(0);
  });

  it('sets the cover flag, including clearing it', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const first = newId();
    const second = newId();

    await ctx.request(user.token).postBytes(imageUploadPath(taskId, 'one.png', first), PNG_1X1);
    await ctx.request(user.token).postBytes(imageUploadPath(taskId, 'two.png', second), PNG_1X1);

    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: first });
    expect((await imageRows(taskId)).filter((row) => row.is_cover).map((row) => row.id)).toEqual([
      first,
    ]);

    // Moving the cover must clear the old one, or the partial unique index that
    // makes "one cover per task" true would reject the write.
    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: second });
    expect((await imageRows(taskId)).filter((row) => row.is_cover).map((row) => row.id)).toEqual([
      second,
    ]);

    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: null });
    expect((await imageRows(taskId)).filter((row) => row.is_cover)).toHaveLength(0);
  });

  it('writes copies made by duplicating a card, under the copy ids', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const imageId = newId();

    await ctx.request(user.token).postBytes(imageUploadPath(taskId, 'pixel.png', imageId), PNG_1X1);
    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: imageId });

    const copyId = newId();
    const res = await ctx
      .request(user.token)
      .post(`/api/tasks/${taskId}/duplicate`, { id: copyId, sort_key: rankKey(2000) });
    expect(res.status).toBe(201);

    const copies = await imageRows(copyId);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).not.toBe(imageId);
    expect(copies[0]!.is_cover).toBe(true);

    // A copy is a fresh object, never a second row pointing at the original's
    // bytes — deleting the source must not blank the copy.
    const sourceKey = await db
      .selectFrom('task_attachment')
      .select('image_storage_key as storage_key')
      .where('id', '=', imageId)
      .where('kind', '=', 'image')
      .executeTakeFirstOrThrow();
    expect(copies[0]!.image_storage_key).not.toBe(sourceKey.storage_key);
  });

  it('surfaces as an attachment in the detail, the board count and the export', async () => {
    const { projectId, taskId } = await createTaskFixture(user.id);

    await ctx.request(user.token).postBytes(imageUploadPath(taskId, 'pixel.png'), PNG_1X1);

    const detail = (await (await ctx.request(user.token).get(`/api/tasks/${taskId}`)).json()) as {
      attachments: { kind: string; image_url: string; is_cover: boolean }[];
      image_count: number;
    };
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0]).toMatchObject({ kind: 'image', is_cover: false });

    const board = (await (
      await ctx.request(user.token).get(`/api/projects/${projectId}`)
    ).json()) as { tasks: { id: string; image_count: number; attachment_count: number }[] };
    const card = board.tasks.find((task) => task.id === taskId);
    expect(card?.attachment_count).toBe(1);

    // project.json merged its two arrays as well, at version 4: one model
    // everywhere, including the interchange format that describes it.
    const exported = (await (
      await ctx.request(user.token).get(`/api/projects/${projectId}/export?format=json`)
    ).json()) as {
      version: number;
      tasks: { id: string; attachments: { kind: string; path: string }[] }[];
    };
    expect(exported.version).toBe(4);
    const exportedTask = exported.tasks.find((task) => task.id === taskId);
    expect(exportedTask?.attachments).toHaveLength(1);
    expect(exportedTask?.attachments[0]).toMatchObject({ kind: 'image' });
    expect(exportedTask?.attachments[0]?.path).toMatch(/^attachments\//);

    // Counted once, from the one table.
    const allowance = await projectStorageAllowance(db, projectId);
    expect(allowance.used).toBe(PNG_1X1.length);
  });
});
