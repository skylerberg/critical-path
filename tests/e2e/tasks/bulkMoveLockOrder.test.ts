import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db, waitForLockWaiters } from '../../helpers/database';
import { lockColumnTail } from '../../../src/services/boardColumns';
import { ProjectFixtures } from './taskFixtures';

// `POST /api/columns/:id/move-tasks` and `DELETE /api/columns/:id?move_tasks_to=`
// take the destination's tail lock and only then reach the task rows, through
// the write that follows. A bulk move that locked its rows first and asked for
// the tail lock second would close the cycle: a drag into a column and a column
// emptied into it would deadlock, and Postgres would answer one of them 500.
describe('Lock order of a bulk move', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let owner: TestUser;
  let projectId: string;
  let source: string;
  let target: string;
  let taskId: string;

  beforeAll(async () => {
    owner = await ctx.createUser('bulk-lock-order');
    projectId = await fixtures.createProject('bulk lock order', { createdBy: owner.id });
    source = await fixtures.createColumn(projectId, { name: 'Source', position: 1000 });
    target = await fixtures.createColumn(projectId, { name: 'Target', position: 2000 });
    taskId = await fixtures.createTaskRow(projectId, source, 'contended');
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  function holdColumnTail(columnId: string): {
    taken: Promise<unknown>;
    release: () => void;
    done: Promise<void>;
  } {
    let take!: () => void;
    const taken = new Promise<void>((resolve) => {
      take = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = db.transaction().execute(async (trx) => {
      await lockColumnTail(trx, columnId);
      take();
      await released;
    });
    return { taken: Promise.race([taken, done]), release, done };
  }

  // The one thing a request blocked on the tail lock can be asked: whether it is
  // already sitting on the row it is about to move.
  async function alreadyLocked(id: string): Promise<boolean> {
    try {
      await db.selectFrom('task').select('id').where('id', '=', id).forUpdate().noWait().execute();
      return false;
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '55P03') {
        return true;
      }
      throw err;
    }
  }

  it('waits for the destination column holding no task row', async () => {
    const holder = holdColumnTail(target);
    await holder.taken;

    const move = ctx.request(owner.token).post('/api/tasks/bulk-move', {
      project_id: projectId,
      task_ids: [taskId],
      column_id: target,
    });
    try {
      await waitForLockWaiters(1);
      expect(await alreadyLocked(taskId)).toBe(false);
    } finally {
      holder.release();
    }
    await holder.done;

    expect((await move).status).toBe(200);
    const row = await db
      .selectFrom('task')
      .select('column_id')
      .where('id', '=', taskId)
      .executeTakeFirstOrThrow();
    expect(row.column_id).toBe(target);
  });
});
