import { describe, it, expect, afterAll, vi } from 'vitest';
import { Hono } from 'hono';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import { errorHandler } from '../../src/middleware/errorHandler';
import { transactionMiddleware } from '../../src/middleware/transaction';
import type { Variables } from '../../src/types/index';

describe('transactionMiddleware', () => {
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', userIds).execute();
    }
  });

  function buildApp(hook: () => Promise<void>, failAfterWrite: boolean) {
    const app = new Hono<{ Variables: Variables }>();
    app.use('*', transactionMiddleware);
    app.onError(errorHandler);
    app.post('/users/:id', async (c) => {
      await c
        .get('db')
        .insertInto('app_user')
        .values({
          id: c.req.param('id'),
          email: uniqueEmail('tx'),
          password_hash: 'irrelevant',
          name: 'tx user',
        })
        .execute();
      c.get('postCommitHooks').push(hook);
      if (failAfterWrite) {
        throw new Error('post-write failure');
      }
      return c.body(null, 204);
    });
    return app;
  }

  async function userRowExists(id: string): Promise<boolean> {
    const row = await db
      .selectFrom('app_user')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return row !== undefined;
  }

  it('rolls back writes and skips post-commit hooks when the handler throws after writing', async () => {
    const hook = vi.fn(async () => {});
    const app = buildApp(hook, true);
    const id = newId();
    userIds.push(id);

    const res = await app.request(`/users/${id}`, { method: 'POST' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'An internal server error occurred. Please try again later.',
    });
    expect(await userRowExists(id)).toBe(false);
    expect(hook).not.toHaveBeenCalled();
  });

  it('commits writes and runs post-commit hooks when the handler succeeds', async () => {
    const hook = vi.fn(async () => {});
    const app = buildApp(hook, false);
    const id = newId();
    userIds.push(id);

    const res = await app.request(`/users/${id}`, { method: 'POST' });

    expect(res.status).toBe(204);
    expect(await userRowExists(id)).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
  });
});
