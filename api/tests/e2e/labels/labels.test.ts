import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

describe('Labels API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let user: TestUser;

  async function createProject(name: string): Promise<string> {
    const id = newId();
    await db.insertInto('project').values({ id, name, created_by: user.id }).execute();
    projectIds.push(id);
    return id;
  }

  async function createLabel(
    projectId: string,
    name: string,
    color = '#ff0000'
  ): Promise<{ id: string; project_id: string; name: string; color: string }> {
    const id = newId();
    const res = await ctx
      .request(user.token)
      .post('/api/labels', { id, project_id: projectId, name, color });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; project_id: string; name: string; color: string };
  }

  beforeAll(async () => {
    user = await ctx.createUser('labels');
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  describe('POST /api/labels', () => {
    it('requires auth', async () => {
      const res = await ctx.request().post('/api/labels', {
        id: newId(),
        project_id: newId(),
        name: 'Art',
        color: '#ff0000',
      });
      expect(res.status).toBe(401);
    });

    it('creates a label and normalizes the color to lowercase', async () => {
      const projectId = await createProject('labels-create');
      const id = newId();

      const res = await ctx.request(user.token).post('/api/labels', {
        id,
        project_id: projectId,
        name: 'Art',
        color: '#FFAA00',
      });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        id,
        project_id: projectId,
        name: 'Art',
        color: '#ffaa00',
      });
    });

    it('returns 422 when the project does not exist', async () => {
      const res = await ctx.request(user.token).post('/api/labels', {
        id: newId(),
        project_id: newId(),
        name: 'Orphan',
        color: '#ff0000',
      });
      expect(res.status).toBe(422);
    });

    it('returns 409 for a duplicate id', async () => {
      const projectId = await createProject('labels-dup-id');
      const label = await createLabel(projectId, 'First');

      const res = await ctx.request(user.token).post('/api/labels', {
        id: label.id,
        project_id: projectId,
        name: 'Second',
        color: '#00ff00',
      });
      expect(res.status).toBe(409);
    });

    it('returns 409 for a duplicate name in the same project', async () => {
      const projectId = await createProject('labels-dup-name');
      await createLabel(projectId, 'Design');

      const res = await ctx.request(user.token).post('/api/labels', {
        id: newId(),
        project_id: projectId,
        name: 'Design',
        color: '#00ff00',
      });
      expect(res.status).toBe(409);
    });

    it('allows the same name in a different project', async () => {
      const projectA = await createProject('labels-same-name-a');
      const projectB = await createProject('labels-same-name-b');
      await createLabel(projectA, 'Design');

      const res = await ctx.request(user.token).post('/api/labels', {
        id: newId(),
        project_id: projectB,
        name: 'Design',
        color: '#00ff00',
      });
      expect(res.status).toBe(201);
    });

    it('rejects a malformed hex color with 422', async () => {
      const projectId = await createProject('labels-bad-color');

      for (const color of ['red', '#fff', '#12345g', 'ff0000']) {
        const res = await ctx.request(user.token).post('/api/labels', {
          id: newId(),
          project_id: projectId,
          name: `Bad ${color}`,
          color,
        });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: string; details: { path: string }[] };
        expect(body.error).toBe('Validation failed');
        expect(body.details.some((d) => d.path === 'color')).toBe(true);
      }
    });
  });

  describe('PATCH /api/labels/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().patch(`/api/labels/${newId()}`, { name: 'Nope' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown label', async () => {
      const res = await ctx.request(user.token).patch(`/api/labels/${newId()}`, { name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('renames and recolors a label', async () => {
      const projectId = await createProject('labels-patch');
      const label = await createLabel(projectId, 'Old name', '#ff0000');

      const renamed = await ctx
        .request(user.token)
        .patch(`/api/labels/${label.id}`, { name: 'New name' });
      expect(renamed.status).toBe(200);
      expect(await renamed.json()).toEqual({
        id: label.id,
        project_id: projectId,
        name: 'New name',
        color: '#ff0000',
      });

      const recolored = await ctx
        .request(user.token)
        .patch(`/api/labels/${label.id}`, { color: '#0000FF' });
      expect(recolored.status).toBe(200);
      expect(await recolored.json()).toEqual({
        id: label.id,
        project_id: projectId,
        name: 'New name',
        color: '#0000ff',
      });
    });

    it('returns the label unchanged for an empty patch', async () => {
      const projectId = await createProject('labels-empty-patch');
      const label = await createLabel(projectId, 'Unchanged', '#123456');

      const res = await ctx.request(user.token).patch(`/api/labels/${label.id}`, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(label);
    });

    it('returns 409 when renaming to an existing name in the project', async () => {
      const projectId = await createProject('labels-patch-conflict');
      await createLabel(projectId, 'Taken');
      const label = await createLabel(projectId, 'Free');

      const res = await ctx.request(user.token).patch(`/api/labels/${label.id}`, { name: 'Taken' });
      expect(res.status).toBe(409);
    });

    it('rejects a malformed hex color with 422', async () => {
      const projectId = await createProject('labels-patch-bad-color');
      const label = await createLabel(projectId, 'Recolor me');

      const res = await ctx
        .request(user.token)
        .patch(`/api/labels/${label.id}`, { color: 'not-a-color' });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('DELETE /api/labels/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().delete(`/api/labels/${newId()}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown label', async () => {
      const res = await ctx.request(user.token).delete(`/api/labels/${newId()}`);
      expect(res.status).toBe(404);
    });

    it('deletes a label', async () => {
      const projectId = await createProject('labels-delete');
      const label = await createLabel(projectId, 'Doomed');

      const res = await ctx.request(user.token).delete(`/api/labels/${label.id}`);
      expect(res.status).toBe(204);

      const row = await db
        .selectFrom('label')
        .select('id')
        .where('id', '=', label.id)
        .executeTakeFirst();
      expect(row).toBeUndefined();

      const again = await ctx.request(user.token).delete(`/api/labels/${label.id}`);
      expect(again.status).toBe(404);
    });

    it('removes task_label associations but keeps the task', async () => {
      const projectId = await createProject('labels-delete-assoc');
      const label = await createLabel(projectId, 'Attached');

      const columnId = newId();
      await db
        .insertInto('board_column')
        .values({ id: columnId, project_id: projectId, name: 'To Do', position: 1000 })
        .execute();
      const taskId = newId();
      await db
        .insertInto('task')
        .values({
          id: taskId,
          project_id: projectId,
          column_id: columnId,
          title: 'Labeled task',
          position: 1000,
        })
        .execute();
      await db.insertInto('task_label').values({ task_id: taskId, label_id: label.id }).execute();

      const res = await ctx.request(user.token).delete(`/api/labels/${label.id}`);
      expect(res.status).toBe(204);

      const associations = await db
        .selectFrom('task_label')
        .select('task_id')
        .where('label_id', '=', label.id)
        .execute();
      expect(associations).toEqual([]);

      const task = await db
        .selectFrom('task')
        .select('id')
        .where('id', '=', taskId)
        .executeTakeFirst();
      expect(task).toEqual({ id: taskId });
    });
  });
});
