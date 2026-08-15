import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext, TestUser } from '../setup/testContext';
import { db } from '../helpers/database';
import { newId } from '../helpers/fixtures';

const OVER_LIMIT = 'x'.repeat(1024 * 1024);
const UNDER_LIMIT = 'y'.repeat(900_000);

describe('global request body limit', () => {
  const ctx = new TestContext();
  let user: TestUser;

  beforeAll(async () => {
    user = await ctx.createUser('bodylimit');
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('refuses a body over 1 MB on an ordinary JSON route and writes nothing', async () => {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/feedback', { id, message: OVER_LIMIT });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Payload too large' });

    const row = await db
      .selectFrom('feedback')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  // Mounted ahead of authMiddleware, so the bytes cost a stranger nothing to
  // send and the pod nothing to hold.
  it('refuses an oversized body before it looks for a credential', async () => {
    const res = await ctx.request().post('/api/feedback', { id: newId(), message: OVER_LIMIT });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'Payload too large' });
  });

  it('lets a body under the cap through to the route', async () => {
    const res = await ctx
      .request(user.token)
      .post('/api/feedback', { id: newId(), message: UNDER_LIMIT });

    expect(res.status).toBe(422);
    const body = await res.json<{ error: string; details: { path: string }[] }>();
    expect(body.error).toBe('Validation failed');
    expect(body.details.some((detail) => detail.path === 'message')).toBe(true);
  });
});
