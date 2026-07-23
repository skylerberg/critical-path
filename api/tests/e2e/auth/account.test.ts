import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { uniqueEmail } from '../../helpers/fixtures';
import { resetRateLimiter } from '../../../src/middleware/rateLimit';
import { createResetToken } from '../../../src/services/resetToken';
import { subscribeBus, SESSIONS_REVOKED, type BusEntry } from '../../../src/services/realtime/bus';

async function alternativeIdOf(userId: string): Promise<string> {
  const row = await db
    .selectFrom('app_user')
    .select('alternative_id')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return row.alternative_id;
}

async function collectBusEntries(run: () => Promise<void>): Promise<BusEntry[]> {
  const seen: BusEntry[] = [];
  const unsubscribe = subscribeBus((entry) => seen.push(entry));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return seen;
}

describe('Account management', () => {
  const ctx = new TestContext();

  afterAll(async () => {
    await ctx.cleanup();
    resetRateLimiter();
  });

  describe('PATCH /api/auth/me', () => {
    it('updates the name', async () => {
      const user = await ctx.createUser('patch-name');
      const res = await ctx.request(user.token).patch('/api/auth/me', { name: 'Renamed User' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: user.id, email: user.email, name: 'Renamed User' });

      const me = await ctx.request(user.token).get('/api/auth/me');
      expect(await me.json()).toEqual({ id: user.id, email: user.email, name: 'Renamed User' });
    });

    it('updates the email, keeps the session valid, and allows login with the new email', async () => {
      const user = await ctx.createUser('patch-email');
      const newEmail = uniqueEmail('patched');
      const res = await ctx.request(user.token).patch('/api/auth/me', { email: newEmail });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: user.id, email: newEmail, name: user.name });

      const me = await ctx.request(user.token).get('/api/auth/me');
      expect(me.status).toBe(200);

      const login = await ctx
        .request()
        .post('/api/auth/login', { email: newEmail, password: user.password });
      expect(login.status).toBe(200);
    });

    it('rotates alternative_id on email change, invalidating outstanding reset tokens', async () => {
      const user = await ctx.createUser('patch-rotate');
      const before = await alternativeIdOf(user.id);
      const oldToken = createResetToken(before);

      const res = await ctx
        .request(user.token)
        .patch('/api/auth/me', { email: uniqueEmail('rotated') });
      expect(res.status).toBe(200);
      expect(await alternativeIdOf(user.id)).not.toBe(before);

      const reset = await ctx
        .request()
        .post('/api/auth/reset-password', { token: oldToken, new_password: 'after-rotate-123' });
      expect(reset.status).toBe(422);
      expect((await reset.json()).error).toBe('Invalid reset token');
    });

    it('does not rotate alternative_id on a name-only change', async () => {
      const user = await ctx.createUser('patch-no-rotate');
      const before = await alternativeIdOf(user.id);

      const res = await ctx.request(user.token).patch('/api/auth/me', { name: 'Still Me' });
      expect(res.status).toBe(200);
      expect(await alternativeIdOf(user.id)).toBe(before);
    });

    it("rejects another user's email case-insensitively with 409", async () => {
      const a = await ctx.createUser('patch-dup-a');
      const b = await ctx.createUser('patch-dup-b');

      const res = await ctx
        .request(b.token)
        .patch('/api/auth/me', { email: a.email.toUpperCase() });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBeTypeOf('string');

      const me = await ctx.request(b.token).get('/api/auth/me');
      expect(await me.json()).toEqual({ id: b.id, email: b.email, name: b.name });
    });

    it('returns the current user unchanged for an empty patch', async () => {
      const user = await ctx.createUser('patch-empty');
      const res = await ctx.request(user.token).patch('/api/auth/me', {});

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: user.id, email: user.email, name: user.name });
    });

    it('returns 422 for an invalid email', async () => {
      const user = await ctx.createUser('patch-invalid');
      const res = await ctx.request(user.token).patch('/api/auth/me', { email: 'not-an-email' });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    });

    it('requires auth', async () => {
      const res = await ctx.request().patch('/api/auth/me', { name: 'Anon' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('rejects a wrong current password with 401 and keeps sessions valid', async () => {
      const user = await ctx.createUser('cp-wrong');
      const res = await ctx.request(user.token).post('/api/auth/change-password', {
        current_password: 'not-the-password',
        new_password: 'new-password-123',
      });
      expect(res.status).toBe(401);

      const me = await ctx.request(user.token).get('/api/auth/me');
      expect(me.status).toBe(200);

      const login = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });
      expect(login.status).toBe(200);
    });

    it('changes the password, revokes prior sessions, and returns a fresh session', async () => {
      const user = await ctx.createUser('cp-ok');
      const otherLogin = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });
      const otherToken = ((await otherLogin.json()) as { token: string }).token;

      let newToken = '';
      const seen = await collectBusEntries(async () => {
        const res = await ctx.request(user.token).post('/api/auth/change-password', {
          current_password: user.password,
          new_password: 'changed-password-123',
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { token: string; user: { id: string; email: string } };
        expect(body.user).toEqual({ id: user.id, email: user.email, name: user.name });
        newToken = body.token;
      });
      expect(seen).toEqual([
        { type: SESSIONS_REVOKED, project_id: null, data: { user_id: user.id } },
      ]);

      expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(401);
      expect((await ctx.request(otherToken).get('/api/auth/me')).status).toBe(401);
      expect((await ctx.request(newToken).get('/api/auth/me')).status).toBe(200);

      const oldLogin = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });
      expect(oldLogin.status).toBe(401);

      const newLogin = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: 'changed-password-123' });
      expect(newLogin.status).toBe(200);
    });

    it('rotates alternative_id, invalidating outstanding reset tokens', async () => {
      const user = await ctx.createUser('cp-rotate');
      const before = await alternativeIdOf(user.id);
      const oldToken = createResetToken(before);

      const res = await ctx.request(user.token).post('/api/auth/change-password', {
        current_password: user.password,
        new_password: 'changed-password-123',
      });
      expect(res.status).toBe(200);
      expect(await alternativeIdOf(user.id)).not.toBe(before);

      const reset = await ctx
        .request()
        .post('/api/auth/reset-password', { token: oldToken, new_password: 'another-pass-123' });
      expect(reset.status).toBe(422);
      expect((await reset.json()).error).toBe('Invalid reset token');
    });

    it('returns 422 for a too-short new password', async () => {
      const user = await ctx.createUser('cp-short');
      const res = await ctx.request(user.token).post('/api/auth/change-password', {
        current_password: user.password,
        new_password: 'short',
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    });

    it('requires auth', async () => {
      const res = await ctx.request().post('/api/auth/change-password', {
        current_password: 'whatever-123',
        new_password: 'new-password-123',
      });
      expect(res.status).toBe(401);
    });
  });
});
