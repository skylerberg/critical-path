import crypto from 'crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { TestContext, sessionCookieFrom } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { env } from '../../../src/config/env';
import { SESSION_COOKIE_NAME } from '../../../src/services/sessionCookie';

const DAY_MS = 24 * 60 * 60 * 1000;

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Expiry is idle-based: the clock restarts on use, so the only sessions that
// lapse are the ones nobody came back to. Every case here pins where the line
// between those two sits, because nothing else would notice it moving — a
// renewal that stopped happening reads as a user being signed out a year later.
describe('Session renewal', () => {
  const ctx = new TestContext();
  const ttlMs = env.sessionTtlDays * DAY_MS;

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function insertSession(
    userId: string,
    expiresAt: Date
  ): Promise<{ id: string; token: string }> {
    const id = newId();
    const token = `renewal-${id}`;
    await db
      .insertInto('session')
      .values({ id, user_id: userId, token_hash: sha256Hex(token), expires_at: expiresAt })
      .execute();
    return { id, token };
  }

  async function expiryOf(id: string): Promise<Date | null> {
    const row = await db
      .selectFrom('session')
      .select('session.expires_at')
      .where('session.id', '=', id)
      .executeTakeFirst();
    return row?.expires_at ?? null;
  }

  it('carries a session past the halfway mark forward on its next request', async () => {
    const user = await ctx.createUser('renew-due');
    const { id, token } = await insertSession(user.id, new Date(Date.now() + 10 * DAY_MS));

    expect((await ctx.request(token).get('/api/auth/me')).status).toBe(200);

    // A full TTL measured from the request, not ten days and a bit: the clock
    // restarts, it does not creep forward by whatever was left.
    const renewed = await expiryOf(id);
    expect(renewed?.getTime()).toBeGreaterThan(Date.now() + ttlMs - 60_000);
  });

  it('leaves a session still in the first half of its life alone', async () => {
    const user = await ctx.createUser('renew-fresh');
    const expiresAt = new Date(Date.now() + ttlMs - DAY_MS);
    const { id, token } = await insertSession(user.id, expiresAt);

    expect((await ctx.request(token).get('/api/auth/me')).status).toBe(200);

    // The write is what costs something, so not making it is the behaviour.
    expect((await expiryOf(id))?.getTime()).toBe(expiresAt.getTime());
  });

  it('renews on a mutation as readily as on a read', async () => {
    const user = await ctx.createUser('renew-mutation');
    const { id, token } = await insertSession(user.id, new Date(Date.now() + 10 * DAY_MS));
    const other = await insertSession(user.id, new Date(Date.now() + 10 * DAY_MS));

    const res = await ctx.request(token).delete(`/api/auth/sessions/${other.id}`);
    expect(res.status).toBe(204);

    expect((await expiryOf(id))?.getTime()).toBeGreaterThan(Date.now() + ttlMs - 60_000);
  });

  it('leaves the cookie to the next read when the renewal lands on a mutation', async () => {
    const user = await ctx.createUser('renew-mutation-cookie');
    const { token } = await insertSession(user.id, new Date(Date.now() + 10 * DAY_MS));
    const other = await insertSession(user.id, new Date(Date.now() + 10 * DAY_MS));

    // Logout manages this cookie itself, so a mutation may not also write one;
    // the row is the credential and the backfill rebuilds the cookie on a read.
    const res = await ctx
      .request(token)
      .withCookie(`${SESSION_COOKIE_NAME}=${token}`)
      .delete(`/api/auth/sessions/${other.id}`);

    expect(res.status).toBe(204);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('re-issues the cookie on the read that renews, though one was presented', async () => {
    const user = await ctx.createUser('renew-cookie');
    const { token } = await insertSession(user.id, new Date(Date.now() + 10 * DAY_MS));

    const res = await ctx
      .request(token)
      .withCookie(`${SESSION_COOKIE_NAME}=${token}`)
      .get('/api/auth/me');

    expect(res.status).toBe(200);
    // Same token, new Max-Age: the cookie goes on measuring the lifetime the
    // row now has rather than the one it was issued against.
    expect(sessionCookieFrom(res)).toBe(`${SESSION_COOKIE_NAME}=${token}`);
    const header = res.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(header).toContain(`Max-Age=${String(env.sessionTtlDays * 24 * 60 * 60)}`);
  });

  it('does not renew a session that has already lapsed', async () => {
    const user = await ctx.createUser('renew-expired');
    const { id, token } = await insertSession(user.id, new Date(Date.now() - DAY_MS));

    expect((await ctx.request(token).get('/api/auth/me')).status).toBe(401);

    expect(await expiryOf(id)).toBeNull();
  });
});
