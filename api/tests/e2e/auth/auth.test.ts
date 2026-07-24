import { describe, it, expect, afterAll } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { resetRateLimiter } from '../../../src/middleware/rateLimit';

describe('Auth', () => {
  const ctx = new TestContext();
  const manualUserIds: string[] = [];

  afterAll(async () => {
    await ctx.cleanup();
    if (manualUserIds.length > 0) {
      await db.deleteFrom('app_user').where('id', 'in', manualUserIds).execute();
    }
    resetRateLimiter();
  });

  describe('POST /api/auth/signup', () => {
    it('creates an account and returns a token and user', async () => {
      const id = newId();
      const email = uniqueEmail('signup');
      const res = await ctx
        .request()
        .post('/api/auth/signup', { id, email, password: 'password-123', name: 'Signup User' });
      manualUserIds.push(id);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.token).toBeTypeOf('string');
      expect(body.token.length).toBeGreaterThan(20);
      expect(body.user).toEqual({ id, email, name: 'Signup User', avatar_url: null });
    });

    it('rejects a taken email case-insensitively with 409', async () => {
      const user = await ctx.createUser('dup-email');
      const res = await ctx.request().post('/api/auth/signup', {
        id: newId(),
        email: user.email.toUpperCase(),
        password: 'password-123',
        name: 'Dup Email',
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBeTypeOf('string');
    });

    it('rejects a duplicate user id with 409', async () => {
      const user = await ctx.createUser('dup-id');
      const res = await ctx.request().post('/api/auth/signup', {
        id: user.id,
        email: uniqueEmail('dup-id-other'),
        password: 'password-123',
        name: 'Dup Id',
      });

      expect(res.status).toBe(409);
    });

    it('returns 422 with details for an invalid body', async () => {
      const res = await ctx.request().post('/api/auth/signup', {
        id: 'not-a-uuid',
        email: 'not-an-email',
        password: 'short',
        name: '',
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
      for (const detail of body.details) {
        expect(detail.path).toBeTypeOf('string');
        expect(detail.message).toBeTypeOf('string');
      }
    });

    it('returns a generic body for unexpected errors instead of the internal message', async () => {
      const res = await ctx.request().post('/api/auth/signup', {
        id: newId(),
        email: uniqueEmail('null-byte'),
        password: 'password-123',
        name: 'null\u0000byte',
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'An internal server error occurred. Please try again later.',
      });
    });
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid credentials', async () => {
      const user = await ctx.createUser('login');
      const res = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBeTypeOf('string');
      expect(body.token).not.toBe(user.token);
      expect(body.user).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: null,
      });
    });

    it('rejects a wrong password with 401', async () => {
      const user = await ctx.createUser('bad-pass');
      const res = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: 'wrong-password-123' });

      expect(res.status).toBe(401);
    });

    it('rejects an unknown email with 401', async () => {
      const res = await ctx
        .request()
        .post('/api/auth/login', { email: uniqueEmail('unknown'), password: 'password-123' });

      expect(res.status).toBe(401);
    });

    it('rate limits after 10 attempts for the same email with 429', async () => {
      const email = uniqueEmail('rate-limit');
      for (let i = 0; i < 10; i++) {
        const res = await ctx
          .request()
          .post('/api/auth/login', { email, password: 'password-123' });
        expect(res.status).toBe(401);
      }

      const limited = await ctx
        .request()
        .post('/api/auth/login', { email, password: 'password-123' });
      expect(limited.status).toBe(429);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deletes the session', async () => {
      const user = await ctx.createUser('logout');

      const res = await ctx.request(user.token).post('/api/auth/logout');
      expect(res.status).toBe(204);

      const me = await ctx.request(user.token).get('/api/auth/me');
      expect(me.status).toBe(401);
    });

    it('requires auth', async () => {
      const res = await ctx.request().post('/api/auth/logout');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns the authenticated user', async () => {
      const user = await ctx.createUser('me');
      const res = await ctx.request(user.token).get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: null,
      });
    });

    it('rejects a missing token with 401', async () => {
      const res = await ctx.request().get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('rejects an invalid token with 401', async () => {
      const res = await ctx.request('not-a-real-token').get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });
});
