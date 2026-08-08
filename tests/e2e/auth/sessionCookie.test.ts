import { describe, it, expect, afterAll } from 'vitest';
import { TestContext, sessionCookieFrom } from '../../setup/testContext';
import { SESSION_COOKIE_NAME } from '../../../src/services/sessionCookie';

// The cookie mirrors the bearer token so that <img src="/api/images/…"> can be
// authenticated at all. Nothing requires it yet — these hold the issuing half
// so the release that starts requiring it cannot find browsers without one.
describe('Session cookie', () => {
  const ctx = new TestContext();

  afterAll(async () => {
    await ctx.cleanup();
  });

  function setCookieHeader(res: Response): string | undefined {
    return res.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  }

  it('issues the cookie at signup, carrying the token the body returns', async () => {
    const id = crypto.randomUUID();
    const email = `cookie-signup-${crypto.randomUUID()}@test.example.com`;
    const res = await ctx
      .request()
      .post('/api/auth/signup', { id, email, password: 'test-password-123', name: 'Cookie' });

    expect(res.status).toBe(201);
    const { token } = (await res.json()) as { token: string };
    expect(sessionCookieFrom(res)).toBe(`${SESSION_COOKIE_NAME}=${token}`);

    await ctx.request(token).delete('/api/auth/account', { password: 'test-password-123' });
  });

  it('marks the cookie HttpOnly, SameSite=Lax and path-wide', async () => {
    const user = await ctx.createUser('cookie-attrs');
    const res = await ctx
      .request()
      .post('/api/auth/login', { email: user.email, password: user.password });

    const header = setCookieHeader(res);
    expect(header).toBeDefined();
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    // Not Secure outside production, or nothing would work over plain http in
    // development, where the app and the API share http://localhost.
    expect(header).not.toContain('Secure');
  });

  it('issues the cookie at login', async () => {
    const user = await ctx.createUser('cookie-login');
    const res = await ctx
      .request()
      .post('/api/auth/login', { email: user.email, password: user.password });

    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(sessionCookieFrom(res)).toBe(`${SESSION_COOKIE_NAME}=${token}`);
  });

  it('backfills a session that predates the cookie, on the next request it makes', async () => {
    const user = await ctx.createUser('cookie-backfill');

    // A browser holding a token but no cookie is exactly what every session
    // signed in before this release looks like.
    const res = await ctx.request(user.token).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(sessionCookieFrom(res)).toBe(`${SESSION_COOKIE_NAME}=${user.token}`);
  });

  it('does not re-issue the cookie to a request that already carries it', async () => {
    const user = await ctx.createUser('cookie-no-reissue');
    const res = await ctx
      .request(user.token)
      .withCookie(`${SESSION_COOKIE_NAME}=${user.token}`)
      .get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(setCookieHeader(res)).toBeUndefined();
  });

  it('never turns a personal access token into a cookie', async () => {
    const user = await ctx.createUser('cookie-pat');
    const created = await ctx
      .request(user.token)
      .post('/api/auth/tokens', { id: crypto.randomUUID(), name: 'cli' });
    expect(created.status).toBe(201);
    const { token: pat } = (await created.json()) as { token: string };

    const res = await ctx.request(pat).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(setCookieHeader(res)).toBeUndefined();
  });

  it('clears the cookie at logout', async () => {
    const user = await ctx.createUser('cookie-logout');
    const res = await ctx.request(user.token).post('/api/auth/logout');

    expect(res.status).toBe(204);
    const header = setCookieHeader(res);
    expect(header).toBeDefined();
    expect(sessionCookieFrom(res)).toBeNull();
  });

  it('leaves the cookie alone when the password changes, as the session survives', async () => {
    const user = await ctx.createUser('cookie-password');
    const res = await ctx.request(user.token).post('/api/auth/change-password', {
      current_password: user.password,
      new_password: 'replacement-password-456',
    });

    expect(res.status).toBe(204);
    expect(setCookieHeader(res)).toBeUndefined();
    // Still signed in on the same credential, so the cookie it holds still works.
    expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(200);
  });
});
