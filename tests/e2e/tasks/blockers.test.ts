import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
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
      sort_key: rankKey(1000),
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

  async function crossProjectCountOf(id: string): Promise<number> {
    const res = await ctx.request(user.token).get(`/api/tasks/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()).open_cross_project_blocker_count as number;
  }

  async function edgeExists(blockedId: string, blockerId: string): Promise<boolean> {
    const row = await db
      .selectFrom('task_dependency')
      .select('blocker_task_id')
      .where('blocked_task_id', '=', blockedId)
      .where('blocker_task_id', '=', blockerId)
      .executeTakeFirst();
    return row !== undefined;
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

    it('accepts a blocker from another project the caller can read', async () => {
      const task = await createTask('cross project blocked');
      const otherProject = await fixtures.createProject('blockers other project', {
        createdBy: user.id,
      });
      const otherColumn = await fixtures.createColumn(otherProject);
      const foreignTask = await createTask('foreign', otherProject, otherColumn);

      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: foreignTask });
      expect(res.status).toBe(204);

      // Named nowhere: blocker_ids resolves against the board payload, which
      // holds one project. The edge reaches the card as a count instead.
      const detail = await ctx.request(user.token).get(`/api/tasks/${task}`);
      const body = await detail.json();
      expect(body.blocker_ids).toEqual([]);
      expect(body.open_cross_project_blocker_count).toBe(1);
    });

    it('accepts a blocker the caller may read but not write', async () => {
      const task = await createTask('viewer-side blocked');
      const ownerId = await fixtures.createUser('blockers-far-owner');
      const readOnlyProject = await fixtures.createProject('read-only far project', {
        createdBy: ownerId,
      });
      const readOnlyColumn = await fixtures.createColumn(readOnlyProject);
      const foreignTask = await fixtures.createTaskRow(
        readOnlyProject,
        readOnlyColumn,
        'read-only blocker'
      );
      await db
        .insertInto('project_member')
        .values({ project_id: readOnlyProject, user_id: user.id, role: 'viewer' })
        .execute();

      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: foreignTask });
      expect(res.status).toBe(204);
      expect(await edgeExists(task, foreignTask)).toBe(true);
      expect(await crossProjectCountOf(task)).toBe(1);
    });

    it('rejects an unknown blocker task with 422', async () => {
      const task = await createTask('unknown blocker target');
      const res = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: newId() });
      expect(res.status).toBe(422);
    });

    it('answers an inaccessible blocker exactly as it answers a nonexistent one', async () => {
      const task = await createTask('oracle target');
      const stranger = await ctx.createUser('blockers-stranger');
      const theirProject = await fixtures.createProject('unreachable project', {
        createdBy: stranger.id,
      });
      const theirColumn = await fixtures.createColumn(theirProject);
      const theirTask = await ctx.request(stranger.token).post('/api/tasks', {
        id: newId(),
        project_id: theirProject,
        column_id: theirColumn,
        title: 'unreachable',
        sort_key: rankKey(1000),
      });
      expect(theirTask.status).toBe(201);
      const theirTaskId = (await theirTask.json()).id as string;

      const hidden = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: theirTaskId });
      const missing = await ctx
        .request(user.token)
        .post(`/api/tasks/${task}/blockers`, { blocker_task_id: newId() });

      // Byte-identical, so the route cannot be used to test whether an id names
      // a real task.
      expect(hidden.status).toBe(422);
      expect(missing.status).toBe(422);
      expect(await hidden.json()).toEqual(await missing.json());
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

      const neverExisted = await ctx
        .request(user.token)
        .delete(`/api/tasks/${blocked}/blockers/${newId()}`);
      expect(neverExisted.status).toBe(204);
    });

    it('detaches an edge whose blocker sits in a project the caller cannot read', async () => {
      const blocked = await createTask('stranded');
      const strangerId = await fixtures.createUser('blockers-lost-access');
      const theirProject = await fixtures.createProject('lost access project', {
        createdBy: strangerId,
      });
      const theirColumn = await fixtures.createColumn(theirProject);
      const theirTask = await fixtures.createTaskRow(theirProject, theirColumn, 'gone dark');
      // Seeded directly: no route hands out an edge into a project the caller
      // cannot read, and losing that access afterwards is the state under test.
      await fixtures.createDependencyRow(theirTask, blocked);
      expect(await edgeExists(blocked, theirTask)).toBe(true);

      const removed = await ctx
        .request(user.token)
        .delete(`/api/tasks/${blocked}/blockers/${theirTask}`);
      expect(removed.status).toBe(204);

      expect(await edgeExists(blocked, theirTask)).toBe(false);
      // A delete that matched nothing answers 204 too, so this is what tells the
      // two apart: the recount that follows would have restored the 1.
      expect(await crossProjectCountOf(blocked)).toBe(0);
    });
  });
});
