import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import { ProjectFixtures, validDescription, descriptionWithLink } from './taskFixtures';

describe('Tasks CRUD', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('tasks-crud');
    projectId = await fixtures.createProject('tasks e2e project', { createdBy: user.id });
    columnId = await fixtures.createColumn(projectId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  function taskBody(overrides: Record<string, unknown> = {}) {
    return {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'A task',
      position: 1000,
      ...overrides,
    };
  }

  describe('POST /api/tasks', () => {
    it('requires auth', async () => {
      const res = await ctx.request().post('/api/tasks', taskBody());
      expect(res.status).toBe(401);
    });

    it('creates a task with labels and assignees in board-payload shape', async () => {
      const assignee = await ctx.createUser('tasks-crud-assignee');
      const workspaceId = newId();
      await db
        .insertInto('workspace')
        .values({ id: workspaceId, name: 'tasks crud ws', created_by: user.id })
        .execute();
      await db
        .insertInto('workspace_member')
        .values([
          { workspace_id: workspaceId, user_id: user.id },
          { workspace_id: workspaceId, user_id: assignee.id },
        ])
        .execute();
      const sharedProjectId = await fixtures.createProject('tasks crud shared', {
        createdBy: user.id,
        workspaceId,
      });
      const sharedColumnId = await fixtures.createColumn(sharedProjectId);
      const labelA = await fixtures.createLabel(sharedProjectId, `label-a-${newId()}`);
      const labelB = await fixtures.createLabel(sharedProjectId, `label-b-${newId()}`);

      const body = taskBody({
        project_id: sharedProjectId,
        column_id: sharedColumnId,
        description: validDescription(),
        label_ids: [labelA, labelB, labelA],
        assignee_ids: [user.id, assignee.id],
      });
      const res = await ctx.request(user.token).post('/api/tasks', body);
      expect(res.status).toBe(201);

      const task = await res.json();
      expect(task).toMatchObject({
        id: body.id,
        column_id: sharedColumnId,
        title: 'A task',
        description: validDescription(),
        position: 1000,
        blocker_ids: [],
        image_count: 0,
      });
      expect(task.label_ids.sort()).toEqual([labelA, labelB].sort());
      expect(task.assignee_ids.sort()).toEqual([user.id, assignee.id].sort());
      expect(typeof task.created_at).toBe('string');
      expect(typeof task.updated_at).toBe('string');
      expect(task).not.toHaveProperty('project_id');
    });

    it('creates a task without a description as null', async () => {
      const res = await ctx.request(user.token).post('/api/tasks', taskBody());
      expect(res.status).toBe(201);
      const task = await res.json();
      expect(task.description).toBeNull();
      expect(task.label_ids).toEqual([]);
      expect(task.assignee_ids).toEqual([]);
    });

    it('returns 409 for a duplicate task id', async () => {
      const body = taskBody();
      const first = await ctx.request(user.token).post('/api/tasks', body);
      expect(first.status).toBe(201);
      const second = await ctx.request(user.token).post('/api/tasks', body);
      expect(second.status).toBe(409);
    });

    it('rejects a column from another project with 422', async () => {
      const otherProject = await fixtures.createProject('other project', { createdBy: user.id });
      const otherColumn = await fixtures.createColumn(otherProject);
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ column_id: otherColumn }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('column_id');
    });

    it('rejects an unknown column with 422', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ column_id: newId() }));
      expect(res.status).toBe(422);
    });

    it('rejects a label from another project with 422', async () => {
      const otherProject = await fixtures.createProject('other label project', {
        createdBy: user.id,
      });
      const otherLabel = await fixtures.createLabel(otherProject, `foreign-${newId()}`);
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ label_ids: [otherLabel] }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('label');
    });

    it('rejects an unknown assignee with 422', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ assignee_ids: [newId()] }));
      expect(res.status).toBe(422);
    });

    it('rejects a javascript: link href in the description with 422', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ description: descriptionWithLink('javascript:alert(1)') }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('accepts an https: link href in the description', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ description: descriptionWithLink('https://example.com') }));
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().get(`/api/tasks/${newId()}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).get(`/api/tasks/${newId()}`);
      expect(res.status).toBe(404);
    });

    it('returns 400 with a plain error body for a malformed id', async () => {
      const res = await ctx.request(user.token).get('/api/tasks/not-a-uuid');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe('string');
      expect(body.data).toBeUndefined();
      expect(body.success).toBeUndefined();
    });

    it('returns task detail with project_id and an images array', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      expect(created.status).toBe(201);
      const { id } = await created.json();

      const empty = await ctx.request(user.token).get(`/api/tasks/${id}`);
      expect(empty.status).toBe(200);
      const emptyBody = await empty.json();
      expect(emptyBody.project_id).toBe(projectId);
      expect(emptyBody.images).toEqual([]);
      expect(emptyBody.image_count).toBe(0);

      const imageId = await fixtures.createImageRow(id, { filename: 'shot.png' });
      const res = await ctx.request(user.token).get(`/api/tasks/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.image_count).toBe(1);
      expect(body.images).toHaveLength(1);
      expect(body.images[0]).toMatchObject({
        id: imageId,
        url: `/api/images/${imageId}`,
        filename: 'shot.png',
        content_type: 'image/png',
        size_bytes: 4,
      });
      expect(typeof body.images[0].created_at).toBe('string');
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().patch(`/api/tasks/${newId()}`, { title: 'x' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).patch(`/api/tasks/${newId()}`, { title: 'x' });
      expect(res.status).toBe(404);
    });

    it('updates the title and bumps updated_at', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { title: 'renamed' });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.title).toBe('renamed');
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
        new Date(original.updated_at).getTime()
      );
      expect(updated.created_at).toBe(original.created_at);
    });

    it('clears the description with null', async () => {
      const created = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ description: validDescription() }));
      const { id } = await created.json();

      const res = await ctx.request(user.token).patch(`/api/tasks/${id}`, { description: null });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.description).toBeNull();
    });

    it('rejects a javascript: link href in the description with 422', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx.request(user.token).patch(`/api/tasks/${id}`, {
        description: descriptionWithLink('javascript:alert(1)'),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('moves a task with column_id and position', async () => {
      const targetColumn = await fixtures.createColumn(projectId, { name: 'Done', position: 2000 });
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${id}`, { column_id: targetColumn, position: 500 });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.column_id).toBe(targetColumn);
      expect(updated.position).toBe(500);
    });

    it('rejects moving to a column of another project with 422', async () => {
      const otherProject = await fixtures.createProject('patch cross project', {
        createdBy: user.id,
      });
      const otherColumn = await fixtures.createColumn(otherProject);
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${id}`, { column_id: otherColumn, position: 500 });
      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().delete(`/api/tasks/${newId()}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).delete(`/api/tasks/${newId()}`);
      expect(res.status).toBe(404);
    });

    it('deletes the task, cascades dependencies, and removes stored images post-commit', async () => {
      const createdA = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id: blockerId } = await createdA.json();
      const createdB = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id: blockedId } = await createdB.json();

      const addBlocker = await ctx
        .request(user.token)
        .post(`/api/tasks/${blockedId}/blockers`, { blocker_task_id: blockerId });
      expect(addBlocker.status).toBe(204);

      const storageKey = newId();
      await storage.put(storageKey, Buffer.from('fake'), 'image/png');
      await fixtures.createImageRow(blockerId, { storageKey });
      expect(await storage.get(storageKey)).not.toBeNull();

      const res = await ctx.request(user.token).delete(`/api/tasks/${blockerId}`);
      expect(res.status).toBe(204);

      const gone = await ctx.request(user.token).get(`/api/tasks/${blockerId}`);
      expect(gone.status).toBe(404);

      const blocked = await ctx.request(user.token).get(`/api/tasks/${blockedId}`);
      const blockedBody = await blocked.json();
      expect(blockedBody.blocker_ids).toEqual([]);

      await vi.waitFor(async () => {
        expect(await storage.get(storageKey)).toBeNull();
      });
    });
  });
});
