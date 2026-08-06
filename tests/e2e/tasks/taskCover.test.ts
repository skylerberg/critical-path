import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { insertTaskImage } from '../projects/helpers';
import { ProjectFixtures } from './taskFixtures';
import { subscribeBus, type BusEntry } from '../../../src/services/realtime/bus';

describe('PUT /api/tasks/:id/cover', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('task-cover');
    outsider = await ctx.createUser('task-cover-outsider');
    projectId = await fixtures.createProject('task cover project', { createdBy: user.id });
    columnId = await fixtures.createColumn(projectId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function createTask(): Promise<string> {
    return fixtures.createTaskRow(projectId, columnId, 'cover target');
  }

  async function coverRows(taskId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('task_attachment')
      .select('id')
      .where('task_id', '=', taskId)
      .where('is_cover', '=', true)
      .where('kind', '=', 'image')
      .execute();
    return rows.map((row) => row.id);
  }

  async function boardCover(taskId: string): Promise<string | null | undefined> {
    const res = await ctx.request(user.token).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { tasks: Array<{ id: string; cover_image_url: string }> };
    return payload.tasks.find((task) => task.id === taskId)?.cover_image_url;
  }

  it('requires auth', async () => {
    const res = await ctx.request().put(`/api/tasks/${newId()}/cover`, { image_id: null });
    expect(res.status).toBe(401);
  });

  it('returns 404 for an unknown task', async () => {
    const res = await ctx
      .request(user.token)
      .put(`/api/tasks/${newId()}/cover`, { image_id: null });
    expect(res.status).toBe(404);
  });

  it('returns 404, not 403, for a task the caller cannot reach', async () => {
    const taskId = await createTask();
    const { imageId } = await insertTaskImage({ taskId });

    const res = await ctx
      .request(outsider.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: imageId });
    expect(res.status).toBe(404);
    expect(await coverRows(taskId)).toEqual([]);
  });

  it('sets the cover and exposes it on the board payload and the task detail', async () => {
    const taskId = await createTask();
    const { imageId } = await insertTaskImage({ taskId });

    const res = await ctx
      .request(user.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: imageId });
    expect(res.status).toBe(204);

    expect(await coverRows(taskId)).toEqual([imageId]);
    expect(await boardCover(taskId)).toBe(`/api/images/${imageId}`);

    const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).cover_image_url).toBe(`/api/images/${imageId}`);
  });

  it('leaves the cover null until one is chosen', async () => {
    const taskId = await createTask();
    await insertTaskImage({ taskId });

    expect(await boardCover(taskId)).toBeNull();
    const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect((await detail.json()).cover_image_url).toBeNull();
  });

  it('switching the cover clears the previous one', async () => {
    const taskId = await createTask();
    const { imageId: first } = await insertTaskImage({ taskId });
    const { imageId: second } = await insertTaskImage({ taskId });

    expect(
      (await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: first })).status
    ).toBe(204);
    expect(
      (await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: second })).status
    ).toBe(204);

    expect(await coverRows(taskId)).toEqual([second]);
    expect(await boardCover(taskId)).toBe(`/api/images/${second}`);
  });

  it('clears the cover with a null image_id', async () => {
    const taskId = await createTask();
    const { imageId } = await insertTaskImage({ taskId, isCover: true });

    const res = await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: null });
    expect(res.status).toBe(204);

    expect(await coverRows(taskId)).toEqual([]);
    expect(await boardCover(taskId)).toBeNull();

    const image = await db
      .selectFrom('task_attachment')
      .select('id')
      .where('id', '=', imageId)
      .where('kind', '=', 'image')
      .executeTakeFirst();
    expect(image).toBeDefined();
  });

  it('clearing an absent cover is an idempotent 204', async () => {
    const taskId = await createTask();
    await insertTaskImage({ taskId });

    const first = await ctx
      .request(user.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: null });
    const second = await ctx
      .request(user.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: null });
    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(await coverRows(taskId)).toEqual([]);
  });

  it('rejects an image belonging to another task with 422', async () => {
    const taskId = await createTask();
    const otherTaskId = await createTask();
    const { imageId } = await insertTaskImage({ taskId: otherTaskId });

    const res = await ctx
      .request(user.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: imageId });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('image_id must reference an image on this task');
    expect(await coverRows(taskId)).toEqual([]);
    expect(await coverRows(otherTaskId)).toEqual([]);
  });

  it('rejects an unknown image id with 422', async () => {
    const taskId = await createTask();

    const res = await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, {
      image_id: newId(),
    });
    expect(res.status).toBe(422);
  });

  it('rejects a malformed body with 422', async () => {
    const taskId = await createTask();

    const missing = await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, {});
    expect(missing.status).toBe(422);
    expect(await missing.json()).toHaveProperty('details');

    const wrongType = await ctx
      .request(user.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: 'nope' });
    expect(wrongType.status).toBe(422);
    expect(await wrongType.json()).toHaveProperty('details');
  });

  it('leaves a validation failure with the cover it already had', async () => {
    const taskId = await createTask();
    const { imageId } = await insertTaskImage({ taskId });
    expect(
      (await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: imageId }))
        .status
    ).toBe(204);

    const res = await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, {
      image_id: newId(),
    });
    expect(res.status).toBe(422);
    expect(await coverRows(taskId)).toEqual([imageId]);
  });

  it('deleting the cover image clears the cover and leaves the task alone', async () => {
    const taskId = await createTask();
    const { imageId: cover } = await insertTaskImage({ taskId, isCover: true });
    await insertTaskImage({ taskId });

    const res = await ctx.request(user.token).delete(`/api/attachments/${cover}`);
    expect(res.status).toBe(204);

    expect(await coverRows(taskId)).toEqual([]);
    expect(await boardCover(taskId)).toBeNull();

    const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect(detail.status).toBe(200);
  });

  it('deleting a non-cover image leaves the cover in place', async () => {
    const taskId = await createTask();
    const { imageId: cover } = await insertTaskImage({ taskId, isCover: true });
    const { imageId: other } = await insertTaskImage({ taskId });

    expect((await ctx.request(user.token).delete(`/api/attachments/${other}`)).status).toBe(204);

    expect(await coverRows(taskId)).toEqual([cover]);
    expect(await boardCover(taskId)).toBe(`/api/images/${cover}`);
  });

  it('the database refuses two covers on one task', async () => {
    const taskId = await createTask();
    await insertTaskImage({ taskId, isCover: true });

    await expect(insertTaskImage({ taskId, isCover: true })).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('lets two tasks each hold a cover', async () => {
    const firstTaskId = await createTask();
    const secondTaskId = await createTask();
    const { imageId: firstImage } = await insertTaskImage({ taskId: firstTaskId });
    const { imageId: secondImage } = await insertTaskImage({ taskId: secondTaskId });

    for (const [taskId, imageId] of [
      [firstTaskId, firstImage],
      [secondTaskId, secondImage],
    ] as const) {
      expect(
        (await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: imageId }))
          .status
      ).toBe(204);
    }

    expect(await coverRows(firstTaskId)).toEqual([firstImage]);
    expect(await coverRows(secondTaskId)).toEqual([secondImage]);
  });

  it('serializes concurrent cover writes instead of failing one', async () => {
    const taskId = await createTask();
    const { imageId: first } = await insertTaskImage({ taskId });
    const { imageId: second } = await insertTaskImage({ taskId });

    const responses = await Promise.all([
      ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: first }),
      ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id: second }),
    ]);
    expect(responses.map((res) => res.status)).toEqual([204, 204]);

    const covers = await coverRows(taskId);
    expect(covers).toHaveLength(1);
    expect(await boardCover(taskId)).toBe(`/api/images/${covers[0]}`);
  });

  it('publishes the cover it committed', async () => {
    const taskId = await createTask();
    const { imageId } = await insertTaskImage({ taskId });

    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));
    try {
      for (const image_id of [imageId, null]) {
        expect(
          (await ctx.request(user.token).put(`/api/tasks/${taskId}/cover`, { image_id })).status
        ).toBe(204);
      }
    } finally {
      unsubscribe();
    }

    const published = seen
      .filter((entry) => entry.type === 'task_updated')
      .map((entry) => entry.data as { id: string; cover_image_url: string | null })
      .filter((task) => task.id === taskId);
    expect(published.map((task) => task.cover_image_url)).toEqual([`/api/images/${imageId}`, null]);
    expect(await coverRows(taskId)).toEqual([]);
  });
});
