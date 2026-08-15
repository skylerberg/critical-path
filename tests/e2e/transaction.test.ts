import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import { errorHandler } from '../../src/middleware/errorHandler';
import { transactionMiddleware } from '../../src/middleware/transaction';
import { logger } from '../../src/utils/logger';
import type { Variables } from '../../src/types/index';

describe('transactionMiddleware', () => {
  const userIds: string[] = [];

  afterAll(async () => {
    if (userIds.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', userIds).execute();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildApp(hooks: Array<() => Promise<void>>, failAfterWrite: boolean) {
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
      c.get('postCommitHooks').push(...hooks);
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
    const app = buildApp([hook], true);
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
    const app = buildApp([hook], false);
    const id = newId();
    userIds.push(id);

    const res = await app.request(`/users/${id}`, { method: 'POST' });

    expect(res.status).toBe(204);
    expect(await userRowExists(id)).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
  });

  // The isolation src/services/realtime/bus.ts relies on in writing: an enqueue
  // that fails must not suppress the publish queued beside it, and the response
  // is already committed by the time any of them runs.
  it('logs a rejecting post-commit hook and still runs the ones after it', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const first = vi.fn(async () => {});
    const failing = vi.fn(async () => {
      throw new Error('hook boom');
    });
    const last = vi.fn(async () => {});
    const app = buildApp([first, failing, last], false);
    const id = newId();
    userIds.push(id);

    const res = await app.request(`/users/${id}`, { method: 'POST' });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await userRowExists(id)).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith({
      msg: 'Post-commit hook failed',
      path: `/users/${id}`,
      error: 'hook boom',
    });
  });

  // A hook that throws before it returns a promise never reaches .catch.
  // `() => getEmailSender().send(...)` is one: the driver is resolved on the
  // call, so a bad EMAIL_DRIVER throws synchronously and would otherwise turn
  // the committed 201 into a 500 the client retries.
  it('logs a hook that throws before returning a promise and still runs the ones after it', async () => {
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const failing = vi.fn((): Promise<void> => {
      throw new Error('sync boom');
    });
    const last = vi.fn(async () => {});
    const app = buildApp([failing, last], false);
    const id = newId();
    userIds.push(id);

    const res = await app.request(`/users/${id}`, { method: 'POST' });

    expect(res.status).toBe(204);
    expect(await userRowExists(id)).toBe(true);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(last).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith({
      msg: 'Post-commit hook failed',
      path: `/users/${id}`,
      error: 'sync boom',
    });
  });
});
