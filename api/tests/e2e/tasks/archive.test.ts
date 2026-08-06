import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';

interface ArchivedTaskBody {
  id: string;
  column_id: string;
  title: string;
  sort_key: string;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
  image_count: number;
  comment_count: number;
  archived_at: string;
}

interface BoardBody {
  tasks: Array<{ id: string; column_id: string; sort_key: string; blocker_ids: string[] }>;
}

describe('Task archive and restore', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('task-archive');
    outsider = await ctx.createUser('task-archive-outsider');
    projectId = await fixtures.createProject('archive e2e project', { createdBy: user.id });
    columnId = await fixtures.createColumn(projectId, { name: 'Backlog' });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function board(id = projectId, token = user.token): Promise<BoardBody> {
    const res = await ctx.request(token).get(`/api/projects/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as BoardBody;
  }

  async function updatedAt(taskId: string): Promise<string> {
    const res = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { updated_at: string }).updated_at;
  }

  async function archivedTasks(id = projectId, token = user.token): Promise<ArchivedTaskBody[]> {
    const res = await ctx.request(token).get(`/api/projects/${id}/archived-tasks`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { tasks: ArchivedTaskBody[] }).tasks;
  }

  describe('POST /api/tasks/:id/archive', () => {
    it('requires auth', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      const res = await ctx.request().post(`/api/tasks/${taskId}/archive`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).post(`/api/tasks/${newId()}/archive`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for a task in another user's project", async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      const res = await ctx.request(outsider.token).post(`/api/tasks/${taskId}/archive`);
      expect(res.status).toBe(404);
    });

    it('returns the board task shape with archived_at as an ISO string', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId, 'shape check');
      const res = await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      expect(res.status).toBe(200);

      const body = (await res.json()) as ArchivedTaskBody;
      expect(typeof body.archived_at).toBe('string');
      expect(Number.isNaN(Date.parse(body.archived_at))).toBe(false);
      expect(body).toMatchObject({
        id: taskId,
        column_id: columnId,
        title: 'shape check',
        sort_key: expect.any(String),
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
        comment_count: 0,
      });
      expect(typeof body.created_at).toBe('string');
      expect(typeof body.updated_at).toBe('string');
    });

    it('leaves updated_at untouched through archive and restore', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId, 'stable timestamp');
      const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
      expect(detail.status).toBe(200);
      const before = ((await detail.json()) as { updated_at: string }).updated_at;

      const archive = await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      expect(archive.status).toBe(200);
      expect(((await archive.json()) as ArchivedTaskBody).updated_at).toBe(before);
      expect(await updatedAt(taskId)).toBe(before);

      const restore = await ctx.request(user.token).post(`/api/tasks/${taskId}/restore`);
      expect(restore.status).toBe(200);
      expect(((await restore.json()) as { updated_at: string }).updated_at).toBe(before);
      expect(await updatedAt(taskId)).toBe(before);
    });

    it('removes the task from the board payload and from the project task counts', async () => {
      const countedProjectId = await fixtures.createProject('archive counts', {
        createdBy: user.id,
      });
      const openColumnId = await fixtures.createColumn(countedProjectId, { name: 'Open' });
      const doneColumnId = await fixtures.createColumn(countedProjectId, {
        name: 'Done',
        isDone: true,
      });
      const openTaskId = await fixtures.createTaskRow(countedProjectId, openColumnId);
      const doneTaskId = await fixtures.createTaskRow(countedProjectId, doneColumnId);

      const before = await ctx.request(user.token).get('/api/projects');
      const beforeRow = ((await before.json()) as { projects: Array<Record<string, unknown>> })
        .projects;
      expect(beforeRow.find((p) => p.id === countedProjectId)).toMatchObject({
        open_task_count: 1,
        done_task_count: 1,
      });

      expect((await ctx.request(user.token).post(`/api/tasks/${openTaskId}/archive`)).status).toBe(
        200
      );
      expect((await ctx.request(user.token).post(`/api/tasks/${doneTaskId}/archive`)).status).toBe(
        200
      );

      const payload = await board(countedProjectId);
      expect(payload.tasks).toEqual([]);

      const after = await ctx.request(user.token).get('/api/projects');
      const afterRows = ((await after.json()) as { projects: Array<Record<string, unknown>> })
        .projects;
      expect(afterRows.find((p) => p.id === countedProjectId)).toMatchObject({
        open_task_count: 0,
        done_task_count: 0,
      });
    });

    it('is idempotent and keeps the original archived_at', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      const first = await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as ArchivedTaskBody;

      const second = await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as ArchivedTaskBody;

      expect(secondBody.archived_at).toBe(firstBody.archived_at);
    });

    it('drops an archived blocker from its dependents rather than showing it as satisfied', async () => {
      const blockerId = await fixtures.createTaskRow(projectId, columnId, 'blocker');
      const blockedId = await fixtures.createTaskRow(projectId, columnId, 'blocked');
      await fixtures.createDependencyRow(blockerId, blockedId);

      const before = await board();
      expect(before.tasks.find((t) => t.id === blockedId)?.blocker_ids).toEqual([blockerId]);

      expect((await ctx.request(user.token).post(`/api/tasks/${blockerId}/archive`)).status).toBe(
        200
      );

      const after = await board();
      expect(after.tasks.find((t) => t.id === blockedId)?.blocker_ids).toEqual([]);
    });

    it('omits archived blockers from an archived task in the archive list', async () => {
      const archiveProjectId = await fixtures.createProject('nested archive', {
        createdBy: user.id,
      });
      const archiveColumnId = await fixtures.createColumn(archiveProjectId);
      const liveBlockerId = await fixtures.createTaskRow(archiveProjectId, archiveColumnId, 'live');
      const archivedBlockerId = await fixtures.createTaskRow(
        archiveProjectId,
        archiveColumnId,
        'gone'
      );
      const blockedId = await fixtures.createTaskRow(archiveProjectId, archiveColumnId, 'blocked');
      await fixtures.createDependencyRow(liveBlockerId, blockedId);
      await fixtures.createDependencyRow(archivedBlockerId, blockedId);

      await ctx.request(user.token).post(`/api/tasks/${archivedBlockerId}/archive`);
      await ctx.request(user.token).post(`/api/tasks/${blockedId}/archive`);

      const archived = await archivedTasks(archiveProjectId);
      expect(archived.find((t) => t.id === blockedId)?.blocker_ids).toEqual([liveBlockerId]);
    });
  });

  describe('POST /api/tasks/:id/restore', () => {
    it('requires auth and hides inaccessible tasks', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      expect((await ctx.request().post(`/api/tasks/${taskId}/restore`)).status).toBe(401);
      expect((await ctx.request(outsider.token).post(`/api/tasks/${taskId}/restore`)).status).toBe(
        404
      );
      expect((await ctx.request(user.token).post(`/api/tasks/${newId()}/restore`)).status).toBe(
        404
      );
    });

    it('puts the task back in its column with its dependency edges intact', async () => {
      const restoreProjectId = await fixtures.createProject('restore edges', {
        createdBy: user.id,
      });
      const restoreColumnId = await fixtures.createColumn(restoreProjectId);
      const blockerId = await fixtures.createTaskRow(restoreProjectId, restoreColumnId, 'blocker');
      const blockedId = await fixtures.createTaskRow(restoreProjectId, restoreColumnId, 'blocked');
      const dependentId = await fixtures.createTaskRow(
        restoreProjectId,
        restoreColumnId,
        'dependent'
      );
      await fixtures.createDependencyRow(blockerId, blockedId);
      await fixtures.createDependencyRow(blockedId, dependentId);

      await ctx.request(user.token).post(`/api/tasks/${blockedId}/archive`);
      const midway = await board(restoreProjectId);
      expect(midway.tasks.map((t) => t.id)).not.toContain(blockedId);
      expect(midway.tasks.find((t) => t.id === dependentId)?.blocker_ids).toEqual([]);

      const res = await ctx.request(user.token).post(`/api/tasks/${blockedId}/restore`);
      expect(res.status).toBe(200);
      const restored = (await res.json()) as Record<string, unknown>;
      expect(restored).toMatchObject({
        id: blockedId,
        column_id: restoreColumnId,
        sort_key: expect.any(String),
        blocker_ids: [blockerId],
      });
      expect(restored.archived_at).toBeUndefined();

      const after = await board(restoreProjectId);
      expect(after.tasks.map((t) => t.id).sort()).toEqual(
        [blockerId, blockedId, dependentId].sort()
      );
      expect(after.tasks.find((t) => t.id === dependentId)?.blocker_ids).toEqual([blockedId]);
      expect(await archivedTasks(restoreProjectId)).toEqual([]);
    });

    it('restoring a live task changes nothing', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId, 'never archived');
      const res = await ctx.request(user.token).post(`/api/tasks/${taskId}/restore`);
      expect(res.status).toBe(200);
      expect((await res.json()) as { id: string }).toMatchObject({ id: taskId });

      const detail = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
      expect((await detail.json()) as { archived_at: string | null }).toMatchObject({
        archived_at: null,
      });
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('reports archived_at for an archived task and null for a live one', async () => {
      const liveId = await fixtures.createTaskRow(projectId, columnId, 'live detail');
      const archivedId = await fixtures.createTaskRow(projectId, columnId, 'archived detail');
      await ctx.request(user.token).post(`/api/tasks/${archivedId}/archive`);

      const live = await ctx.request(user.token).get(`/api/tasks/${liveId}`);
      expect(live.status).toBe(200);
      expect((await live.json()) as { archived_at: string | null }).toMatchObject({
        archived_at: null,
      });

      const archived = await ctx.request(user.token).get(`/api/tasks/${archivedId}`);
      expect(archived.status).toBe(200);
      const archivedBody = (await archived.json()) as { archived_at: string | null };
      expect(typeof archivedBody.archived_at).toBe('string');
    });
  });

  describe('archived tasks and dependencies', () => {
    it('rejects an archived task as a new blocker with 422', async () => {
      const blockerId = await fixtures.createTaskRow(projectId, columnId, 'archived blocker');
      const blockedId = await fixtures.createTaskRow(projectId, columnId, 'still live');
      await ctx.request(user.token).post(`/api/tasks/${blockerId}/archive`);

      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${blockedId}/blockers`, { blocker_task_id: blockerId });
      expect(res.status).toBe(422);
    });

    it('still walks archived edges when detecting cycles', async () => {
      const cycleProjectId = await fixtures.createProject('cycle through archive', {
        createdBy: user.id,
      });
      const cycleColumnId = await fixtures.createColumn(cycleProjectId);
      const a = await fixtures.createTaskRow(cycleProjectId, cycleColumnId, 'A');
      const b = await fixtures.createTaskRow(cycleProjectId, cycleColumnId, 'B');
      const c = await fixtures.createTaskRow(cycleProjectId, cycleColumnId, 'C');
      await fixtures.createDependencyRow(a, b);
      await fixtures.createDependencyRow(b, c);

      expect((await ctx.request(user.token).post(`/api/tasks/${b}/archive`)).status).toBe(200);

      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${a}/blockers`, { blocker_task_id: c });
      expect(res.status).toBe(409);
    });

    it('lets a blocker be added to an archived task so restore brings the edge back', async () => {
      const edgeProjectId = await fixtures.createProject('edge to archived', {
        createdBy: user.id,
      });
      const edgeColumnId = await fixtures.createColumn(edgeProjectId);
      const blockerId = await fixtures.createTaskRow(edgeProjectId, edgeColumnId, 'blocker');
      const archivedId = await fixtures.createTaskRow(edgeProjectId, edgeColumnId, 'archived');
      await ctx.request(user.token).post(`/api/tasks/${archivedId}/archive`);

      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${archivedId}/blockers`, { blocker_task_id: blockerId });
      expect(res.status).toBe(204);

      const restored = await ctx.request(user.token).post(`/api/tasks/${archivedId}/restore`);
      expect(((await restored.json()) as { blocker_ids: string[] }).blocker_ids).toEqual([
        blockerId,
      ]);
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('hard-deletes an archived task', async () => {
      const deleteProjectId = await fixtures.createProject('delete archived', {
        createdBy: user.id,
      });
      const deleteColumnId = await fixtures.createColumn(deleteProjectId);
      const taskId = await fixtures.createTaskRow(deleteProjectId, deleteColumnId);
      await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);

      const res = await ctx.request(user.token).delete(`/api/tasks/${taskId}`);
      expect(res.status).toBe(204);
      expect(await archivedTasks(deleteProjectId)).toEqual([]);
    });
  });

  describe('GET /api/projects/:id/archived-tasks', () => {
    it('requires auth and hides inaccessible projects', async () => {
      expect((await ctx.request().get(`/api/projects/${projectId}/archived-tasks`)).status).toBe(
        401
      );
      expect(
        (await ctx.request(outsider.token).get(`/api/projects/${projectId}/archived-tasks`)).status
      ).toBe(404);
      expect(
        (await ctx.request(user.token).get(`/api/projects/${newId()}/archived-tasks`)).status
      ).toBe(404);
    });

    it('returns an empty list for a project with nothing archived', async () => {
      const emptyProjectId = await fixtures.createProject('nothing archived', {
        createdBy: user.id,
      });
      const emptyColumnId = await fixtures.createColumn(emptyProjectId);
      await fixtures.createTaskRow(emptyProjectId, emptyColumnId);
      expect(await archivedTasks(emptyProjectId)).toEqual([]);
    });

    it('returns only archived tasks, newest first, in board shape plus archived_at', async () => {
      const listProjectId = await fixtures.createProject('archive listing', {
        createdBy: user.id,
      });
      const listColumnId = await fixtures.createColumn(listProjectId);
      const liveId = await fixtures.createTaskRow(listProjectId, listColumnId, 'stays');
      const firstId = await fixtures.createTaskRow(listProjectId, listColumnId, 'archived first');
      const secondId = await fixtures.createTaskRow(listProjectId, listColumnId, 'archived second');

      await ctx.request(user.token).post(`/api/tasks/${firstId}/archive`);
      await ctx.request(user.token).post(`/api/tasks/${secondId}/archive`);

      const rows = await archivedTasks(listProjectId);
      expect(rows.map((t) => t.id)).toEqual([secondId, firstId]);
      expect(rows.map((t) => t.id)).not.toContain(liveId);
      expect(rows[0]).toMatchObject({
        column_id: listColumnId,
        title: 'archived second',
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
        comment_count: 0,
      });
      expect(typeof rows[0]!.archived_at).toBe('string');
    });
  });
});
