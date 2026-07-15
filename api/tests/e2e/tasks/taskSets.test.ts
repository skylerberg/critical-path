import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';

describe('Task label and assignee sets', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('task-sets');
    projectId = await fixtures.createProject('task sets project');
    columnId = await fixtures.createColumn(projectId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function createTask(): Promise<string> {
    const res = await ctx.request(user.token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'set target',
      position: 1000,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.id;
  }

  async function getTask(id: string) {
    const res = await ctx.request(user.token).get(`/api/tasks/${id}`);
    expect(res.status).toBe(200);
    return res.json();
  }

  describe('PUT /api/tasks/:id/labels', () => {
    it('requires auth', async () => {
      const res = await ctx.request().put(`/api/tasks/${newId()}/labels`, { label_ids: [] });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).put(`/api/tasks/${newId()}/labels`, {
        label_ids: [],
      });
      expect(res.status).toBe(404);
    });

    it('replaces the label set as a diff', async () => {
      const taskId = await createTask();
      const labelA = await fixtures.createLabel(projectId, `set-a-${newId()}`);
      const labelB = await fixtures.createLabel(projectId, `set-b-${newId()}`);
      const labelC = await fixtures.createLabel(projectId, `set-c-${newId()}`);

      const first = await ctx.request(user.token).put(`/api/tasks/${taskId}/labels`, {
        label_ids: [labelA, labelB],
      });
      expect(first.status).toBe(204);
      expect((await getTask(taskId)).label_ids.sort()).toEqual([labelA, labelB].sort());

      const second = await ctx.request(user.token).put(`/api/tasks/${taskId}/labels`, {
        label_ids: [labelB, labelC],
      });
      expect(second.status).toBe(204);
      expect((await getTask(taskId)).label_ids.sort()).toEqual([labelB, labelC].sort());

      const cleared = await ctx.request(user.token).put(`/api/tasks/${taskId}/labels`, {
        label_ids: [],
      });
      expect(cleared.status).toBe(204);
      expect((await getTask(taskId)).label_ids).toEqual([]);
    });

    it('rejects labels from another project with 422', async () => {
      const taskId = await createTask();
      const otherProject = await fixtures.createProject('label set cross project');
      const foreignLabel = await fixtures.createLabel(otherProject, `foreign-${newId()}`);

      const res = await ctx.request(user.token).put(`/api/tasks/${taskId}/labels`, {
        label_ids: [foreignLabel],
      });
      expect(res.status).toBe(422);
      expect((await getTask(taskId)).label_ids).toEqual([]);
    });
  });

  describe('PUT /api/tasks/:id/assignees', () => {
    it('requires auth', async () => {
      const res = await ctx.request().put(`/api/tasks/${newId()}/assignees`, { user_ids: [] });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).put(`/api/tasks/${newId()}/assignees`, {
        user_ids: [],
      });
      expect(res.status).toBe(404);
    });

    it('replaces the assignee set as a diff', async () => {
      const taskId = await createTask();
      const other = await ctx.createUser('task-sets-other');

      const first = await ctx.request(user.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [user.id, other.id],
      });
      expect(first.status).toBe(204);
      expect((await getTask(taskId)).assignee_ids.sort()).toEqual([user.id, other.id].sort());

      const second = await ctx.request(user.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [other.id],
      });
      expect(second.status).toBe(204);
      expect((await getTask(taskId)).assignee_ids).toEqual([other.id]);

      const cleared = await ctx.request(user.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [],
      });
      expect(cleared.status).toBe(204);
      expect((await getTask(taskId)).assignee_ids).toEqual([]);
    });

    it('rejects unknown users with 422', async () => {
      const taskId = await createTask();
      const res = await ctx.request(user.token).put(`/api/tasks/${taskId}/assignees`, {
        user_ids: [newId()],
      });
      expect(res.status).toBe(422);
      expect((await getTask(taskId)).assignee_ids).toEqual([]);
    });
  });
});
