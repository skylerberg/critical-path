import { promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { env } from '../../../src/config/env';
import { projectStorageAllowance } from '../../../src/services/attachments/quota';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function imageForm(filename: string, id?: string): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(PNG_1X1)], filename, { type: 'image/png' }));
  if (id !== undefined) {
    form.append('id', id);
  }
  return form;
}

// Transitional coverage for services/attachments/imageMirror.ts. Two properties
// matter and they pull in opposite directions: the mirror has to be complete, so
// no image is stranded in task_image when reads move across, and it has to be
// invisible, so this release changes nothing a client can observe.
describe('task_image -> task_attachment mirror', () => {
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
      .values({ id: columnId, project_id: projectId, name: 'To Do', position: 1000 })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: projectId,
        column_id: columnId,
        title: 'task',
        position: 1000,
      })
      .execute();

    createdProjectIds.push(projectId);
    return { projectId, columnId, taskId };
  }

  function mirrorRows(taskId: string) {
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
        .selectFrom('task_image')
        .innerJoin('task', 'task.id', 'task_image.task_id')
        .select('task_image.storage_key')
        .where('task.project_id', 'in', createdProjectIds)
        .execute();
      await Promise.all(
        rows.map((row) => fs.rm(path.join(env.storageDiskRoot, row.storage_key), { force: true }))
      );
      await db.deleteFrom('project').where('id', 'in', createdProjectIds).execute();
    }
    await ctx.cleanup();
  });

  it('mirrors an upload under the image id, with the same storage key', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const imageId = newId();

    const res = await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm('pixel.png', imageId));
    expect(res.status).toBe(201);

    const source = await db
      .selectFrom('task_image')
      .select(['storage_key', 'content_type', 'size_bytes'])
      .where('id', '=', imageId)
      .executeTakeFirstOrThrow();

    const mirrored = await mirrorRows(taskId);
    expect(mirrored).toEqual([
      {
        id: imageId,
        kind: 'image',
        filename: 'pixel.png',
        size_bytes: source.size_bytes,
        image_storage_key: source.storage_key,
        image_content_type: source.content_type,
        is_cover: false,
      },
    ]);
  });

  it('removes the mirror when the image is deleted', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const imageId = newId();

    await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm('pixel.png', imageId));
    expect(await mirrorRows(taskId)).toHaveLength(1);

    const res = await ctx.request(user.token).delete(`/api/images/${imageId}`);
    expect(res.status).toBe(204);
    expect(await mirrorRows(taskId)).toHaveLength(0);
  });

  it('mirrors the cover flag, including clearing it', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const first = newId();
    const second = newId();

    await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm('one.png', first));
    await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm('two.png', second));

    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: first });
    expect((await mirrorRows(taskId)).filter((row) => row.is_cover).map((row) => row.id)).toEqual([
      first,
    ]);

    // Moving the cover must clear the old one, or the partial unique index that
    // makes "one cover per task" true would reject the write.
    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: second });
    expect((await mirrorRows(taskId)).filter((row) => row.is_cover).map((row) => row.id)).toEqual([
      second,
    ]);

    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: null });
    expect((await mirrorRows(taskId)).filter((row) => row.is_cover)).toHaveLength(0);
  });

  it('mirrors copies made by duplicating a card, under the copy ids', async () => {
    const { taskId } = await createTaskFixture(user.id);
    const imageId = newId();

    await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm('pixel.png', imageId));
    await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: imageId });

    const copyId = newId();
    const res = await ctx
      .request(user.token)
      .post(`/api/tasks/${taskId}/duplicate`, { id: copyId, position: 2000 });
    expect(res.status).toBe(201);

    const copies = await mirrorRows(copyId);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).not.toBe(imageId);
    expect(copies[0]!.is_cover).toBe(true);

    // A copy is a fresh object, never a second row pointing at the original's
    // bytes — deleting the source must not blank the copy.
    const sourceKey = await db
      .selectFrom('task_image')
      .select('storage_key')
      .where('id', '=', imageId)
      .executeTakeFirstOrThrow();
    expect(copies[0]!.image_storage_key).not.toBe(sourceKey.storage_key);
  });

  it('stays invisible: the mirror moves no count, list, quota or export', async () => {
    const { projectId, taskId } = await createTaskFixture(user.id);

    await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm('pixel.png'));

    const detail = (await (await ctx.request(user.token).get(`/api/tasks/${taskId}`)).json()) as {
      images: unknown[];
      attachments: unknown[];
      image_count: number;
    };
    expect(detail.images).toHaveLength(1);
    expect(detail.attachments).toEqual([]);
    expect(detail.image_count).toBe(1);

    const board = (await (
      await ctx.request(user.token).get(`/api/projects/${projectId}`)
    ).json()) as { tasks: { id: string; image_count: number; attachment_count: number }[] };
    const card = board.tasks.find((task) => task.id === taskId);
    expect(card?.image_count).toBe(1);
    expect(card?.attachment_count).toBe(0);

    const exported = (await (
      await ctx.request(user.token).get(`/api/projects/${projectId}/export?format=json`)
    ).json()) as { tasks: { id: string; images: unknown[]; attachments: unknown[] }[] };
    const exportedTask = exported.tasks.find((task) => task.id === taskId);
    expect(exportedTask?.images).toHaveLength(1);
    expect(exportedTask?.attachments).toEqual([]);

    // The bytes are in both tables now, and the quota must still count them once.
    const allowance = await projectStorageAllowance(db, projectId);
    expect(allowance.used).toBe(PNG_1X1.length);
  });
});
