import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { db } from '../../../src/db/index';
import { subscribeBus, type BusEntry } from '../../../src/services/realtime/bus';
import { cleanupProjects, clearUnfurlJobs, createTaskFixture, uploadPath } from './helpers';

const PDF = Buffer.from('%PDF-1.4\nbody\n%%EOF\n');

describe('attachment_count on the board', () => {
  const ctx = new TestContext();
  const createdProjectIds: string[] = [];

  afterAll(async () => {
    await clearUnfurlJobs();
    await cleanupProjects(createdProjectIds);
    await ctx.cleanup();
  });

  async function boardTask(
    token: string,
    projectId: string,
    taskId: string
  ): Promise<{ attachment_count: number }> {
    const res = await ctx.request(token).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    return body.tasks.find((task: { id: string }) => task.id === taskId);
  }

  it('counts both kinds and follows every add and removal', async () => {
    const user = await ctx.createUser('count-board');
    const { projectId, taskId } = await createTaskFixture(user.id, createdProjectIds);

    expect(await boardTask(user.token, projectId, taskId)).toMatchObject({ attachment_count: 0 });

    const file = await ctx.request(user.token).postBytes(uploadPath(taskId, 'spec.pdf'), PDF);
    expect(file.status).toBe(201);
    expect(await boardTask(user.token, projectId, taskId)).toMatchObject({ attachment_count: 1 });

    const linkId = newId();
    const link = await ctx
      .request(user.token)
      .post('/api/attachments/links', { id: linkId, task_id: taskId, url: 'https://example.com/' });
    expect(link.status).toBe(201);
    expect(await boardTask(user.token, projectId, taskId)).toMatchObject({ attachment_count: 2 });

    expect((await ctx.request(user.token).delete(`/api/attachments/${linkId}`)).status).toBe(204);
    expect(await boardTask(user.token, projectId, taskId)).toMatchObject({ attachment_count: 1 });
  });

  it('rides on the created and deleted events so an open board can follow it', async () => {
    const user = await ctx.createUser('count-events');
    const { taskId } = await createTaskFixture(user.id, createdProjectIds);

    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));
    let attachmentId: string;
    try {
      const created = await ctx.request(user.token).postBytes(uploadPath(taskId, 'a.pdf'), PDF);
      expect(created.status).toBe(201);
      attachmentId = (await created.json()).id;
      expect(
        (await ctx.request(user.token).delete(`/api/attachments/${attachmentId}`)).status
      ).toBe(204);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      unsubscribe();
    }

    const events = seen.filter((entry) => entry.type.startsWith('attachment_'));
    expect(events.map((entry) => entry.type)).toEqual(['attachment_created', 'attachment_deleted']);
    expect(events[0].data).toMatchObject({ id: attachmentId, attachment_count: 1 });
    expect(events[1].data).toEqual({
      id: attachmentId,
      task_id: taskId,
      cover_image_url: null,
      attachment_count: 0,
    });
  });

  it('drops to zero with the attachments when a task is emptied', async () => {
    const user = await ctx.createUser('count-cascade');
    const { projectId, taskId } = await createTaskFixture(user.id, createdProjectIds);

    const created = await ctx.request(user.token).postBytes(uploadPath(taskId, 'a.pdf'), PDF);
    expect(created.status).toBe(201);
    expect(await boardTask(user.token, projectId, taskId)).toMatchObject({ attachment_count: 1 });

    await db.deleteFrom('task_attachment').where('task_id', '=', taskId).execute();
    expect(await boardTask(user.token, projectId, taskId)).toMatchObject({ attachment_count: 0 });
  });
});
