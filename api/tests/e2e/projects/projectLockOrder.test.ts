import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db, waitForLockWaiters } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { deleteProjects } from './helpers';

// Two boards whose id order is the reverse of their created_at order, so that a
// locker taking them in either order is telling them apart.
interface ReversedPair {
  lowId: string;
  highId: string;
}

describe('Locking more than one project row', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  const strayUserIds: string[] = [];
  let owner: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('lock-order-owner');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    if (strayUserIds.length > 0) {
      await db.deleteFrom('project').where('created_by', 'in', strayUserIds).execute();
      await db.deleteFrom('app_user').where('id', 'in', strayUserIds).execute();
    }
    await ctx.cleanup();
  });

  async function reversedPair(as: TestUser): Promise<ReversedPair> {
    const [lowId, highId] = [newId(), newId()].sort();
    for (const [index, id] of [highId, lowId].entries()) {
      projectIds.push(id);
      const res = await ctx.request(as.token).post('/api/projects', { id, name: `lock ${id}` });
      expect(res.status).toBe(201);
      await db
        .updateTable('project')
        .set({ created_at: new Date(Date.now() - (10 - index) * 60_000) })
        .where('id', '=', id)
        .execute();
    }
    return { lowId, highId };
  }

  function holdProjectRow(projectId: string): {
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
      await trx
        .selectFrom('project')
        .select('id')
        .where('id', '=', projectId)
        .forUpdate()
        .execute();
      take();
      await released;
    });
    return { taken: Promise.race([taken, done]), release, done };
  }

  // The one thing a statement blocked partway through a multi-row lock can be
  // asked: whether it is already holding the row that sorts ahead of the one it
  // is stuck on.
  async function alreadyLocked(projectId: string): Promise<boolean> {
    try {
      await db
        .selectFrom('project')
        .select('id')
        .where('id', '=', projectId)
        .forUpdate()
        .noWait()
        .execute();
      return false;
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '55P03') {
        return true;
      }
      throw err;
    }
  }

  it('takes the lower id first when a signup claims invitations across boards', async () => {
    const { lowId, highId } = await reversedPair(owner);
    const address = uniqueEmail('lock-order-claim');
    for (const id of [lowId, highId]) {
      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${id}/members/by-email`, { email: address });
      expect(res.status).toBe(200);
    }

    const holder = holdProjectRow(highId);
    await holder.taken;

    const userId = newId();
    strayUserIds.push(userId);
    const signup = ctx.request().post('/api/auth/signup', {
      id: userId,
      email: address,
      password: 'password-123',
      name: 'Claimer',
    });
    try {
      await waitForLockWaiters(1);
      expect(await alreadyLocked(lowId)).toBe(true);
    } finally {
      holder.release();
    }
    await holder.done;

    expect((await signup).status).toBe(201);
  });

  it('takes the lower id first when an account deletion locks the boards it owns', async () => {
    const leaving = await ctx.createUser('lock-order-leaving');
    const { lowId, highId } = await reversedPair(leaving);

    const holder = holdProjectRow(highId);
    await holder.taken;

    const deletion = ctx
      .request(leaving.token)
      .delete('/api/auth/me', { password: leaving.password });
    try {
      await waitForLockWaiters(1);
      expect(await alreadyLocked(lowId)).toBe(true);
    } finally {
      holder.release();
    }
    await holder.done;

    expect((await deletion).status).toBe(204);
  });
});
