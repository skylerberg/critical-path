import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import {
  resetRateLimiter,
  RESET_EMAIL_MAX_ATTEMPTS,
  RESET_IP_MAX_ATTEMPTS,
} from '../../../src/services/rateLimit';
import { createResetToken, RESET_TOKEN_TTL_MS } from '../../../src/services/resetToken';
import { sentEmails, clearSentEmails } from '../../../src/services/email/index';
import { env } from '../../../src/config/env';
import { subscribeBus, type BusEntry } from '../../../src/services/realtime/bus';

async function alternativeIdOf(userId: string): Promise<string> {
  const row = await db
    .selectFrom('app_user')
    .select('alternative_id')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return row.alternative_id;
}

function extractToken(text: string): string {
  const match = text.match(/token=(\S+)/);
  if (!match) {
    throw new Error(`No reset token found in email text: ${text}`);
  }
  return decodeURIComponent(match[1]);
}

describe('Password reset', () => {
  const ctx = new TestContext();

  // Signing up mails a verification link; drop it so each test sees only the
  // mail it is about.
  async function createUser(prefix: string) {
    const user = await ctx.createUser(prefix);
    clearSentEmails();
    return user;
  }

  async function sessionCount(token: string): Promise<number> {
    const res = await ctx.request(token).get('/api/auth/sessions');
    return (await res.json<{ sessions: unknown[] }>()).sessions.length;
  }

  beforeAll(() => {
    process.env.EMAIL_DRIVER = 'memory';
  });

  afterAll(async () => {
    delete process.env.EMAIL_DRIVER;
    await ctx.cleanup();
    resetRateLimiter();
  });

  beforeEach(() => {
    resetRateLimiter();
    clearSentEmails();
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns 404 for an unknown email and sends nothing', async () => {
      const res = await ctx
        .request()
        .post('/api/auth/forgot-password', { email: uniqueEmail('nobody') });

      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('No account exists for that email address');
      expect(sentEmails()).toEqual([]);
    });

    it('emails a reset link for a known email', async () => {
      const user = await createUser('forgot');
      const res = await ctx.request().post('/api/auth/forgot-password', { email: user.email });

      expect(res.status).toBe(204);
      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(user.email);
      expect(emails[0].subject).toContain('password');
      // The literal path. This once read `${env.resetUrlBase}`, comparing the
      // link against the variable that supplied it, so it held whatever the
      // path happened to be.
      expect(emails[0].text).toContain(`${env.appUrlBase}/reset-password?token=`);
    });

    it('matches the email case-insensitively and sends to the stored address', async () => {
      const user = await createUser('forgot-case');
      const res = await ctx
        .request()
        .post('/api/auth/forgot-password', { email: user.email.toUpperCase() });

      expect(res.status).toBe(204);
      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(user.email);
    });

    it('returns 429 when rate limited, without sending', async () => {
      const user = await createUser('forgot-limit');
      for (let i = 0; i < RESET_EMAIL_MAX_ATTEMPTS; i++) {
        const res = await ctx.request().post('/api/auth/forgot-password', { email: user.email });
        expect(res.status).toBe(204);
      }
      expect(sentEmails()).toHaveLength(RESET_EMAIL_MAX_ATTEMPTS);

      const throttled = await ctx
        .request()
        .post('/api/auth/forgot-password', { email: user.email });
      expect(throttled.status).toBe(429);
      expect((await throttled.json()).error).toBe(
        'Too many password reset requests, please try again later'
      );
      expect(sentEmails()).toHaveLength(RESET_EMAIL_MAX_ATTEMPTS);
    });

    // The throttle answers before the lookup, so it cannot become the answer
    // about an address the caller has run out of budget to ask about.
    it('returns 429 rather than 404 for an unknown email once the budget is spent', async () => {
      for (let i = 0; i < RESET_IP_MAX_ATTEMPTS; i++) {
        const res = await ctx
          .request()
          .post('/api/auth/forgot-password', { email: uniqueEmail(`ip-budget-${String(i)}`) });
        expect(res.status).toBe(404);
      }

      const throttled = await ctx
        .request()
        .post('/api/auth/forgot-password', { email: uniqueEmail('ip-budget-next') });
      expect(throttled.status).toBe(429);
    });

    it('returns 422 for an invalid email', async () => {
      const res = await ctx.request().post('/api/auth/forgot-password', { email: 'not-an-email' });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('rejects a tampered token with 422', async () => {
      const user = await createUser('reset-tamper');
      const token = createResetToken(await alternativeIdOf(user.id));
      const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);

      const res = await ctx
        .request()
        .post('/api/auth/reset-password', { token: tampered, new_password: 'new-password-123' });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Invalid reset token');
    });

    it('rejects an expired token with a distinct 422 message', async () => {
      const user = await createUser('reset-expired');
      const token = createResetToken(
        await alternativeIdOf(user.id),
        Date.now() - RESET_TOKEN_TTL_MS - 1000
      );

      const res = await ctx
        .request()
        .post('/api/auth/reset-password', { token, new_password: 'new-password-123' });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Reset token has expired');
    });

    it('rejects a well-formed token whose alternative_id matches no user', async () => {
      const res = await ctx.request().post('/api/auth/reset-password', {
        token: createResetToken(newId()),
        new_password: 'new-password-123',
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Invalid reset token');
    });

    it('resets via the emailed link, keeps sessions signed in, and rotates the token', async () => {
      const user = await createUser('reset-ok');
      const otherLogin = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });
      const otherToken = ((await otherLogin.json()) as { token: string }).token;

      await ctx.request().post('/api/auth/forgot-password', { email: user.email });
      const token = extractToken(sentEmails()[0].text);

      const seen: BusEntry[] = [];
      const unsubscribe = subscribeBus((entry) => seen.push(entry));
      try {
        const res = await ctx
          .request()
          .post('/api/auth/reset-password', { token, new_password: 'after-reset-123' });
        expect(res.status).toBe(200);
      } finally {
        unsubscribe();
      }
      expect(seen).toEqual([]);

      expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(200);
      expect((await ctx.request(otherToken).get('/api/auth/me')).status).toBe(200);

      const oldLogin = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: user.password });
      expect(oldLogin.status).toBe(401);

      const newLogin = await ctx
        .request()
        .post('/api/auth/login', { email: user.email, password: 'after-reset-123' });
      expect(newLogin.status).toBe(200);

      const reuse = await ctx
        .request()
        .post('/api/auth/reset-password', { token, new_password: 'yet-another-123' });
      expect(reuse.status).toBe(422);
      expect((await reuse.json()).error).toBe('Invalid reset token');
    });

    it('returns 422 for a too-short new password without consuming the token', async () => {
      const user = await createUser('reset-short');
      const token = createResetToken(await alternativeIdOf(user.id));

      const res = await ctx
        .request()
        .post('/api/auth/reset-password', { token, new_password: 'short' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');

      const retry = await ctx
        .request()
        .post('/api/auth/reset-password', { token, new_password: 'long-enough-123' });
      expect(retry.status).toBe(200);
    });

    // The point of answering with a session at all: the caller is signed in on
    // the way out, rather than sent to a login form to retype what they just
    // chose. A token that does not work here is the whole feature failing.
    it('answers with a working session for the account the token named', async () => {
      const user = await createUser('reset-session');
      const token = createResetToken(await alternativeIdOf(user.id));

      const res = await ctx
        .request()
        .post('/api/auth/reset-password', { token, new_password: 'signed-in-123' });

      expect(res.status).toBe(200);
      const body = await res.json<{ token: string; user: { id: string; email: string } }>();
      expect(body.user.id).toBe(user.id);
      expect(body.user.email).toBe(user.email);

      const me = await ctx.request(body.token).get('/api/auth/me');
      expect(me.status).toBe(200);
      expect((await me.json()).id).toBe(user.id);
    });

    it('leaves the sessions that predate it alone, and adds exactly one', async () => {
      const user = await createUser('reset-session-count');
      const countBefore = await sessionCount(user.token);

      const res = await ctx.request().post('/api/auth/reset-password', {
        token: createResetToken(await alternativeIdOf(user.id)),
        new_password: 'one-more-session-123',
      });
      expect(res.status).toBe(200);

      expect(await sessionCount(user.token)).toBe(countBefore + 1);
    });

    // A refused reset changes no password, so a session handed out here would be
    // a way in for whoever holds an expired link. The token is this user's, so a
    // handler that created the session before checking it would show up.
    it('starts no session when the token is refused', async () => {
      const user = await createUser('reset-session-refused');
      const countBefore = await sessionCount(user.token);

      const res = await ctx.request().post('/api/auth/reset-password', {
        token: createResetToken(
          await alternativeIdOf(user.id),
          Date.now() - RESET_TOKEN_TTL_MS - 1000
        ),
        new_password: 'never-applied-123',
      });
      expect(res.status).toBe(422);

      expect(await sessionCount(user.token)).toBe(countBefore);
    });
  });
});
