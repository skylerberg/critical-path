import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, waitForLockWaiters } from '../../helpers/database';
import { newId, uniqueEmail, rankKey } from '../../helpers/fixtures';
import { TestContext, TestUser } from '../../setup/testContext';
import { appendPositions, lockColumnTail } from '../../../src/services/boardColumns';
import { keyBetween } from '../../../src/services/sortKey';
import { ProjectFixtures } from './taskFixtures';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('concurrent moves into one column', () => {
  const userId = newId();
  const projectId = newId();
  const targetColumnId = newId();
  const sourceColumnId = newId();
  const sitting = newId();
  const movedA = newId();
  const movedB = newId();

  beforeAll(async () => {
    await db
      .insertInto('app_user')
      .values({ id: userId, email: uniqueEmail('race'), password_hash: 'x', name: 'Race' })
      .execute();
    await db
      .insertInto('project')
      .values({ id: projectId, name: 'Race', created_by: userId })
      .execute();
    await db
      .insertInto('board_column')
      .values([
        { id: targetColumnId, project_id: projectId, name: 'Target', sort_key: rankKey(1000) },
        { id: sourceColumnId, project_id: projectId, name: 'Source', sort_key: rankKey(2000) },
      ])
      .execute();
    await db
      .insertInto('task')
      .values([
        {
          id: sitting,
          project_id: projectId,
          column_id: targetColumnId,
          title: 'already here',
          sort_key: keyBetween(null, null),
        },
        {
          id: movedA,
          project_id: projectId,
          column_id: sourceColumnId,
          title: 'a',
          sort_key: rankKey(1000),
        },
        {
          id: movedB,
          project_id: projectId,
          column_id: sourceColumnId,
          title: 'b',
          sort_key: rankKey(2000),
        },
      ])
      .execute();
  });

  afterAll(async () => {
    await db.deleteFrom('project').where('id', '=', projectId).execute();
    await db.deleteFrom('app_user').where('id', '=', userId).execute();
  });

  // Each transaction does what relocateColumnTasks does: probe the column's tail, then
  // write. The second is released only once the first has committed, so an
  // unserialized probe reads a stale max and stamps a duplicate.
  it('gives each mover its own sort key', async () => {
    const firstHasProbed = deferred();
    const secondHasProbed = deferred();

    async function move(
      taskId: string,
      waitFor: Promise<void> | null,
      probed: () => void,
      release: Promise<void> | null
    ): Promise<string> {
      return db.transaction().execute(async (trx) => {
        if (waitFor) await waitFor;
        const [moved] = await appendPositions(trx, targetColumnId, [taskId]);
        probed();
        if (release) await release;
        await trx
          .updateTable('task')
          .set({ column_id: targetColumnId, sort_key: moved!.sort_key })
          .where('id', '=', taskId)
          .execute();
        return moved!.sort_key;
      });
    }

    const secondReachedProbe = deferred();
    const first = move(movedA, null, firstHasProbed.resolve, secondReachedProbe.promise);
    const second = move(movedB, firstHasProbed.promise, secondHasProbed.resolve, null);

    // The first mover holds its write back until the second has either finished
    // its probe (unserialized: both read the same stale max) or blocked on the
    // lock (serialized). Waiting only for the former would deadlock once the
    // lock exists; only for the latter would never fire without it.
    await Promise.race([
      secondHasProbed.promise,
      waitForLockWaiters(1, 10_000).catch(() => undefined),
    ]);
    secondReachedProbe.resolve();

    const keys = await Promise.all([first, second]);
    expect(new Set(keys).size).toBe(2);

    const rows = await db
      .selectFrom('task')
      .select(['id', 'sort_key'])
      .where('column_id', '=', targetColumnId)
      .where('id', 'in', [movedA, movedB])
      .execute();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.sort_key)).size).toBe(2);
  });
});

// A reorder allocates its run past the column's tail, so it is an appender too:
// without the same lock it and a move into the column read one max, generate
// one key, and the second write violates the unique index.
describe('Reorder against a concurrent appender', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  const parkedKey = rankKey(99_000);
  let owner: TestUser;
  let columnId: string;
  let first: string;
  let second: string;

  beforeAll(async () => {
    owner = await ctx.createUser('reorder-lock-order');
    const projectId = await fixtures.createProject('reorder lock order', { createdBy: owner.id });
    columnId = await fixtures.createColumn(projectId, { name: 'Column', sortKey: rankKey(1000) });
    first = await fixtures.createTaskRow(projectId, columnId, 'first', { position: 1000 });
    second = await fixtures.createTaskRow(projectId, columnId, 'second', { position: 2000 });
    await fixtures.createTaskRow(projectId, columnId, 'archived squatter', {
      sortKey: parkedKey,
      archivedAt: new Date(),
    });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  function holdColumnTail(): { taken: Promise<unknown>; release: () => void; done: Promise<void> } {
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

  it('waits for the column tail holding no task row', async () => {
    const holder = holdColumnTail();
    await holder.taken;

    const reorder = ctx
      .request(owner.token)
      .post(`/api/columns/${columnId}/reorder`, { task_ids: [second, first] });
    try {
      await waitForLockWaiters(1);
      expect(await alreadyLocked(first)).toBe(false);
    } finally {
      holder.release();
    }
    await holder.done;

    const res = await reorder;
    expect(res.status).toBe(200);
    const body = await res.json<{ moved_tasks: Array<{ id: string; sort_key: string }> }>();
    expect(body.moved_tasks.map((task) => task.id)).toEqual([second, first]);
    expect(body.moved_tasks.every((task) => task.sort_key > parkedKey)).toBe(true);

    const rows = await db
      .selectFrom('task')
      .select('id')
      .where('column_id', '=', columnId)
      .where('archived_at', 'is', null)
      .orderBy('sort_key')
      .execute();
    expect(rows.map((row) => row.id)).toEqual([second, first]);
  });
});
