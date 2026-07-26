import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';

describe('Task blockers', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('task-blockers');
    projectId = await fixtures.createProject('blockers project', { createdBy: user.id });
    columnId = await fixtures.createColumn(projectId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function createTask(title: string, targetProjectId = projectId, targetColumnId = columnId) {
    const res = await ctx.request(user.token).post('/api/tasks', {
      id: newId(),
      project_id: targetProjectId,
      column_id: targetColumnId,
      title,
      position: 1000,
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    return body.id as string;
  }

  async function getBlockerIds(id: string): Promise<string[]> {
    const res = await ctx.request(user.token).get(`/api/tasks/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    return body.blocker_ids;
  }

  describe('POST /api/tasks/:id/blockers', () => {
    it('requires auth', async () => {
      const res = await ctx
        .request()
        .post(`/api/tasks/${newId()}/blockers`, { blocker_task_id: newId() });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const blocker = await createTask('existing blocker');
      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${newId()}/blockers`, { blocker_task_id: blocker });
      expect(res.status).toBe(404);
    });

    it('adds a blocker and is idempotent for duplicates', async () => {
      const blocked = await createTask('blocked');
      const blocker = await createTask('blocker');

      const first = await ctx
        .request(user.token)
        .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });
      expect(first.status).toBe(204);
      expect(await getBlockerIds(blocked)).toEqual([blocker]);

      const duplicate = await ctx
        .request(user.token)
        .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });
      expect(duplicate.status).toBe(204);
      expect(await getBlockerIds(blocked)).toEqual([blocker]);
    });

    it('rejects a self blocker with 422', async () => {
      const task = await createTask('self blocker');
      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: task });
      expect(res.status).toBe(422);
    });

    it('rejects a blocker from another project with 422', async () => {
      const task = await createTask('cross project blocked');
      const otherProject = await fixtures.createProject('blockers other project', {
        createdBy: user.id,
      });
      const otherColumn = await fixtures.createColumn(otherProject);
      const foreignTask = await createTask('foreign', otherProject, otherColumn);

      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: foreignTask });
      expect(res.status).toBe(422);
    });

    it('rejects an unknown blocker task with 422', async () => {
      const task = await createTask('unknown blocker target');
      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: newId() });
      expect(res.status).toBe(422);
    });

    it('rejects a direct cycle (A <-> B) with 409 naming the loop', async () => {
      const taskA = await createTask('cycle A');
      const taskB = await createTask('cycle B');

      const forward = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskB}/blockers`, { blocker_task_id: taskA });
      expect(forward.status).toBe(204);

      const backward = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskA}/blockers`, { blocker_task_id: taskB });
      expect(backward.status).toBe(409);
      const body = await backward.json();
      expect(body.error).toBe('Adding this blocker would create a dependency cycle');
      expect(body.cycle).toEqual([
        { id: taskA, title: 'cycle A' },
        { id: taskB, title: 'cycle B' },
        { id: taskA, title: 'cycle A' },
      ]);
      expect(await getBlockerIds(taskA)).toEqual([]);
    });

    it('rejects a transitive cycle (A -> B -> C -> A) with 409 naming the loop', async () => {
      const taskA = await createTask('transitive A');
      const taskB = await createTask('transitive B');
      const taskC = await createTask('transitive C');

      const edgeAB = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskB}/blockers`, { blocker_task_id: taskA });
      expect(edgeAB.status).toBe(204);
      const edgeBC = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskC}/blockers`, { blocker_task_id: taskB });
      expect(edgeBC.status).toBe(204);

      const closing = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskA}/blockers`, { blocker_task_id: taskC });
      expect(closing.status).toBe(409);
      const body = await closing.json();
      expect(body.cycle.map((step: { id: string }) => step.id)).toEqual([
        taskA,
        taskB,
        taskC,
        taskA,
      ]);
      expect(body.cycle.map((step: { title: string }) => step.title)).toEqual([
        'transitive A',
        'transitive B',
        'transitive C',
        'transitive A',
      ]);
      expect(await getBlockerIds(taskA)).toEqual([]);
    });

    it('reports the shortest loop when several close', async () => {
      const taskA = await createTask('shortest A');
      const taskB = await createTask('shortest B');
      const taskC = await createTask('shortest C');

      for (const [blocked, blocker] of [
        [taskB, taskA],
        [taskC, taskB],
        [taskC, taskA],
      ]) {
        const res = await ctx
          .request(user.token)
          .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });
        expect(res.status).toBe(204);
      }

      const closing = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskA}/blockers`, { blocker_task_id: taskC });
      expect(closing.status).toBe(409);
      const body = await closing.json();
      expect(body.cycle.map((step: { id: string }) => step.id)).toEqual([taskA, taskC, taskA]);
    });

    it('names the loop with titles as they are now, not as they were', async () => {
      const taskA = await createTask('renamed A');
      const taskB = await createTask('renamed B');

      const forward = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskB}/blockers`, { blocker_task_id: taskA });
      expect(forward.status).toBe(204);

      const renamed = await ctx
        .request(user.token)
        .patch(`/api/tasks/${taskB}`, { title: 'B after the rename' });
      expect(renamed.status).toBe(200);

      const backward = await ctx
        .request(user.token)
        .post(`/api/tasks/${taskA}/blockers`, { blocker_task_id: taskB });
      expect(backward.status).toBe(409);
      const body = await backward.json();
      expect(body.cycle.map((step: { title: string }) => step.title)).toEqual([
        'renamed A',
        'B after the rename',
        'renamed A',
      ]);
    });
  });

  describe('DELETE /api/tasks/:id/blockers/:blockerTaskId', () => {
    it('requires auth', async () => {
      const res = await ctx.request().delete(`/api/tasks/${newId()}/blockers/${newId()}`);
      expect(res.status).toBe(401);
    });

    it('removes a blocker and is idempotent', async () => {
      const blocked = await createTask('delete blocked');
      const blocker = await createTask('delete blocker');

      const added = await ctx
        .request(user.token)
        .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });
      expect(added.status).toBe(204);

      const removed = await ctx
        .request(user.token)
        .delete(`/api/tasks/${blocked}/blockers/${blocker}`);
      expect(removed.status).toBe(204);
      expect(await getBlockerIds(blocked)).toEqual([]);

      const again = await ctx
        .request(user.token)
        .delete(`/api/tasks/${blocked}/blockers/${blocker}`);
      expect(again.status).toBe(204);
    });
  });
});
