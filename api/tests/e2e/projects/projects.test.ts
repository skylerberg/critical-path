import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import { BoardPayloadBody, deleteProjects, insertTask, insertTaskImage, waitFor } from './helpers';

describe('projects CRUD', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let user: TestUser;

  beforeAll(async () => {
    user = await ctx.createUser('projects-crud');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProject(body: Record<string, unknown>): Promise<Response> {
    const res = await ctx.request(user.token).post('/api/projects', body);
    if (typeof body.id === 'string') {
      projectIds.push(body.id);
    }
    return res;
  }

  describe('authentication', () => {
    it('rejects every endpoint without a token', async () => {
      const id = newId();
      const unauthenticated = ctx.request();
      const responses = await Promise.all([
        unauthenticated.get('/api/projects'),
        unauthenticated.post('/api/projects', { id, name: 'Nope' }),
        unauthenticated.get(`/api/projects/${id}`),
        unauthenticated.patch(`/api/projects/${id}`, { name: 'Nope' }),
        unauthenticated.delete(`/api/projects/${id}`),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(401);
      }
    });
  });

  describe('POST /api/projects', () => {
    it('creates a project with the four default columns and returns a board payload', async () => {
      const id = newId();
      const res = await createProject({ id, name: 'Defaults', description: 'A project' });
      expect(res.status).toBe(201);

      const body = (await res.json()) as BoardPayloadBody;
      expect(body.project).toMatchObject({
        id,
        name: 'Defaults',
        description: 'A project',
        is_template: false,
        archived_at: null,
      });
      expect(typeof body.project.created_at).toBe('string');
      expect(body.tasks).toEqual([]);
      expect(body.labels).toEqual([]);

      expect(body.columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
      expect(body.columns.map((c) => c.position)).toEqual([1000, 2000, 3000, 4000]);
      expect(body.columns.map((c) => c.is_done)).toEqual([false, false, false, true]);
      for (const column of body.columns) {
        expect(column.id).toMatch(/^[0-9a-f-]{36}$/);
      }
    });

    it('defaults description to empty and honors is_template', async () => {
      const id = newId();
      const res = await createProject({ id, name: 'Template', is_template: true });
      expect(res.status).toBe(201);

      const body = (await res.json()) as BoardPayloadBody;
      expect(body.project.description).toBe('');
      expect(body.project.is_template).toBe(true);
    });

    it('returns 409 for a duplicate id', async () => {
      const id = newId();
      const first = await createProject({ id, name: 'Original' });
      expect(first.status).toBe(201);

      const res = await ctx.request(user.token).post('/api/projects', { id, name: 'Duplicate' });
      expect(res.status).toBe(409);
    });

    it('returns 422 when name is missing', async () => {
      const res = await ctx.request(user.token).post('/api/projects', { id: newId() });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });
  });

  describe('GET /api/projects', () => {
    it('lists an empty project with 0/0 counts', async () => {
      const id = newId();
      await createProject({ id, name: 'Empty' });

      const res = await ctx.request(user.token).get('/api/projects');
      expect(res.status).toBe(200);

      const body = await res.json();
      const project = body.projects.find((p: { id: string }) => p.id === id);
      expect(project).toMatchObject({
        id,
        name: 'Empty',
        open_task_count: 0,
        done_task_count: 0,
      });
      expect(typeof project.open_task_count).toBe('number');
      expect(typeof project.done_task_count).toBe('number');
    });

    it('splits counts into open and done by column is_done', async () => {
      const id = newId();
      const createRes = await createProject({ id, name: 'Counted' });
      const board = (await createRes.json()) as BoardPayloadBody;
      const toDo = board.columns.find((c) => c.name === 'To Do')!;
      const done = board.columns.find((c) => c.name === 'Done')!;

      await insertTask({ projectId: id, columnId: toDo.id, position: 1000 });
      await insertTask({ projectId: id, columnId: toDo.id, position: 2000 });
      await insertTask({ projectId: id, columnId: done.id, position: 1000 });

      const res = await ctx.request(user.token).get('/api/projects');
      const body = await res.json();
      const project = body.projects.find((p: { id: string }) => p.id === id);
      expect(project.open_task_count).toBe(2);
      expect(project.done_task_count).toBe(1);
    });
  });

  describe('GET /api/projects/:id', () => {
    it('returns 404 for an unknown project', async () => {
      const res = await ctx.request(user.token).get(`/api/projects/${newId()}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('updates name, description, and is_template', async () => {
      const id = newId();
      await createProject({ id, name: 'Before' });

      const res = await ctx.request(user.token).patch(`/api/projects/${id}`, {
        name: 'After',
        description: 'Updated',
        is_template: true,
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id,
        name: 'After',
        description: 'Updated',
        is_template: true,
        archived_at: null,
      });
    });

    it('archives with an ISO timestamp and unarchives with null', async () => {
      const id = newId();
      await createProject({ id, name: 'Archivable' });
      const archivedAt = '2026-01-02T03:04:05.000Z';

      const archiveRes = await ctx
        .request(user.token)
        .patch(`/api/projects/${id}`, { archived_at: archivedAt });
      expect(archiveRes.status).toBe(200);
      const archived = await archiveRes.json();
      expect(new Date(archived.archived_at).toISOString()).toBe(archivedAt);

      const unarchiveRes = await ctx
        .request(user.token)
        .patch(`/api/projects/${id}`, { archived_at: null });
      expect(unarchiveRes.status).toBe(200);
      expect((await unarchiveRes.json()).archived_at).toBeNull();
    });

    it('returns 422 for a malformed archived_at', async () => {
      const id = newId();
      await createProject({ id, name: 'Bad patch' });

      const res = await ctx
        .request(user.token)
        .patch(`/api/projects/${id}`, { archived_at: 'not-a-date' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    });

    it('returns 404 for an unknown project', async () => {
      const res = await ctx.request(user.token).patch(`/api/projects/${newId()}`, { name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('deletes the project, cascades to its contents, and removes storage objects', async () => {
      const id = newId();
      const createRes = await createProject({ id, name: 'Doomed' });
      const board = (await createRes.json()) as BoardPayloadBody;

      const taskId = await insertTask({ projectId: id, columnId: board.columns[0].id });
      const storageKey = newId();
      await storage.put(storageKey, Buffer.from('img!'), 'image/png');
      await insertTaskImage({ taskId, storageKey });

      const res = await ctx.request(user.token).delete(`/api/projects/${id}`);
      expect(res.status).toBe(204);

      const getRes = await ctx.request(user.token).get(`/api/projects/${id}`);
      expect(getRes.status).toBe(404);

      const taskRow = await db
        .selectFrom('task')
        .select('id')
        .where('id', '=', taskId)
        .executeTakeFirst();
      expect(taskRow).toBeUndefined();

      const columnRows = await db
        .selectFrom('board_column')
        .select('id')
        .where('project_id', '=', id)
        .execute();
      expect(columnRows).toEqual([]);

      await waitFor(async () => (await storage.get(storageKey)) === null);
    });

    it('returns 404 for an unknown project', async () => {
      const res = await ctx.request(user.token).delete(`/api/projects/${newId()}`);
      expect(res.status).toBe(404);
    });
  });
});
