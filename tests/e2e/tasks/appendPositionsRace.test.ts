import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, waitForLockWaiters } from '../../helpers/database';
import { newId, uniqueEmail, rankKey } from '../../helpers/fixtures';
import { appendPositions } from '../../../src/services/boardColumns';

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
          sort_key: rankKey(1000),
          sort_key: 'V0',
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

  // Each transaction does what relocateTasks does: probe the column's tail, then
  // write. The second is released only once the first has committed, so an
  // unserialised probe reads a stale max and stamps a duplicate.
  it('gives each mover its own sort key', async () => {
    const firstHasProbed = deferred();
    const secondHasProbed = deferred();

    async function move(
      taskId: string,
      waitFor: Promise<void> | null,
      probed: () => void,
      release: Promise<void> | null
    ): Promise<number> {
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
    // its probe (unserialised: both read the same stale max) or blocked on the
    // lock (serialised). Waiting only for the former would deadlock once the
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
