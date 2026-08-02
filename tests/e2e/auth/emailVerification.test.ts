import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { TestContext } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import {
  resetRateLimiter,
  VERIFY_IP_MAX_ATTEMPTS,
  VERIFY_USER_MAX_ATTEMPTS,
} from '../../../src/middleware/rateLimit';
import {
  createVerificationToken,
  VERIFICATION_TOKEN_TTL_MS,
} from '../../../src/services/emailToken';
import { sentEmails, clearSentEmails } from '../../../src/services/email/index';
import { env } from '../../../src/config/env';
import { subscribeBus, USER_UPDATED, type BusEntry } from '../../../src/services/realtime/bus';

async function verifiedAtOf(userId: string): Promise<Date | null> {
  const row = await db
    .selectFrom('app_user')
    .select('email_verified_at')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return row.email_verified_at;
}

function extractToken(text: string): string {
  const match = text.match(/token=(\S+)/);
  if (!match) {
    throw new Error(`No verification token found in email text: ${text}`);
  }
  return decodeURIComponent(match[1]);
}

async function tokenFromFreshSignup(ctx: TestContext, prefix: string): Promise<string> {
  clearSentEmails();
  await ctx.createUser(prefix);
  return extractToken(sentEmails()[0].text);
}

describe('Email verification', () => {
  const ctx = new TestContext();

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

  describe('signup', () => {
    const extraUserIds: string[] = [];

    async function signUp(prefix: string): Promise<string> {
      const id = newId();
      const email = uniqueEmail(prefix);
      const res = await ctx
        .request()
        .post('/api/auth/signup', { id, email, password: 'password-123', name: 'Signup' });
      expect(res.status).toBe(201);
      extraUserIds.push(id);
      return email;
    }

    afterEach(async () => {
      if (extraUserIds.length > 0) {
        await db.deleteFrom('app_user').where('id', 'in', extraUserIds).execute();
        extraUserIds.length = 0;
      }
    });

    it('sends exactly one verification email carrying an app link, and starts unverified', async () => {
      const id = newId();
      const email = uniqueEmail('verify-signup');
      const res = await ctx
        .request()
        .post('/api/auth/signup', { id, email, password: 'password-123', name: 'Verify Signup' });

      expect(res.status).toBe(201);
      expect((await res.json()).user.email_verified).toBe(false);
      expect(await verifiedAtOf(id)).toBeNull();

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(email);
      expect(emails[0].text).toContain(`${env.appUrlBase}/verify-email?token=`);

      await db.deleteFrom('app_user').where('id', '=', id).execute();
    });

    it('keeps the address out of the link', async () => {
      const email = uniqueEmail('verify-opaque');
      const id = newId();
      await ctx
        .request()
        .post('/api/auth/signup', { id, email, password: 'password-123', name: 'Opaque' });

      const link = sentEmails()[0].text.match(/https?:\/\/\S+/)?.[0] ?? '';
      expect(link).not.toContain(email);
      expect(link).not.toContain(encodeURIComponent(email));
      expect(link).not.toContain('%40');

      await db.deleteFrom('app_user').where('id', '=', id).execute();
    });

    // Every address is distinct and every send is unauthenticated, so nothing
    // else bounds this; the cap on creating the accounts is what does.
    it('mails every account it creates, with no budget of its own to withhold on', async () => {
      const addresses: string[] = [];
      for (let i = 0; i < VERIFY_IP_MAX_ATTEMPTS + 1; i++) {
        addresses.push(await signUp(`signup-mailed-${i}`));
      }

      expect(sentEmails().map((email) => email.to)).toEqual(addresses);
    });

    // Routing these through the authenticated counter would let signups from a
    // shared egress deny everyone behind it the resend that is their only way back.
    it('leaves an authenticated resend working from an IP that has just signed up many', async () => {
      for (let i = 0; i < VERIFY_IP_MAX_ATTEMPTS + 1; i++) {
        await signUp(`signup-resend-room-${i}`);
      }

      const user = await ctx.createUser('signup-budget-resend');
      clearSentEmails();

      const res = await ctx.request(user.token).post('/api/auth/verify-email/resend');
      expect(res.status).toBe(204);
      expect(sentEmails()).toHaveLength(1);
      expect(sentEmails()[0].to).toBe(user.email);
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('verifies the address and answers 204 without a session or a user record', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-ok');
      const token = extractToken(sentEmails()[0].text);

      const res = await ctx.request().post('/api/auth/verify-email', { token });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');

      expect(await verifiedAtOf(user.id)).not.toBeNull();
      const me = await ctx.request(user.token).get('/api/auth/me');
      expect((await me.json()).email_verified).toBe(true);
    });

    it('is idempotent: a replayed token answers 204 and never moves the recorded time', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-replay');
      const token = extractToken(sentEmails()[0].text);

      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);
      const first = await verifiedAtOf(user.id);
      expect(first).not.toBeNull();

      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);
      expect((await verifiedAtOf(user.id))?.getTime()).toBe(first?.getTime());
    });

    // The interleave is forced with a held row lock rather than raced: the handler's
    // read is a plain select and runs to completion, then its write blocks until the
    // address has already moved underneath it.
    it('never verifies an address the token was not issued for', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-race');
      const token = extractToken(sentEmails()[0].text);
      const moved = uniqueEmail('verify-race-moved');

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const mover = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('app_user')
          .select('id')
          .where('id', '=', user.id)
          .forUpdate()
          .execute();
        await held;
        await trx
          .updateTable('app_user')
          .set({ email: moved, email_verified_at: null })
          .where('id', '=', user.id)
          .execute();
      });

      const redeeming = ctx.request().post('/api/auth/verify-email', { token });
      await new Promise((resolve) => setTimeout(resolve, 150));
      release();
      await mover;
      await redeeming;

      const row = await db
        .selectFrom('app_user')
        .select(['email', 'email_verified_at'])
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow();
      expect(row.email).toBe(moved);
      expect(row.email_verified_at).toBeNull();
    });

    it('treats every outstanding token for the address as equivalent', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-multi');
      const first = extractToken(sentEmails()[0].text);

      clearSentEmails();
      expect((await ctx.request(user.token).post('/api/auth/verify-email/resend')).status).toBe(
        204
      );
      const second = extractToken(sentEmails()[0].text);
      expect(second).not.toBe(first);

      expect((await ctx.request().post('/api/auth/verify-email', { token: first })).status).toBe(
        204
      );
      expect((await ctx.request().post('/api/auth/verify-email', { token: second })).status).toBe(
        204
      );
      expect(await verifiedAtOf(user.id)).not.toBeNull();
    });

    it('rejects an expired token with a message distinct from the invalid one', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-expired');
      const token = createVerificationToken(
        user.id,
        user.email,
        Date.now() - VERIFICATION_TOKEN_TTL_MS - 1000
      );

      const res = await ctx.request().post('/api/auth/verify-email', { token });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Verification link has expired');
      expect(await verifiedAtOf(user.id)).toBeNull();
    });

    it('rejects a token for an address the account has moved away from', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-moved');
      const token = extractToken(sentEmails()[0].text);

      const patch = await ctx
        .request(user.token)
        .patch('/api/auth/me', { email: uniqueEmail('verify-moved-to') });
      expect(patch.status).toBe(200);

      const res = await ctx.request().post('/api/auth/verify-email', { token });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Invalid verification link');
      expect(await verifiedAtOf(user.id)).toBeNull();
    });

    it('rejects a tampered token, and answers identically for an account that does not exist', async () => {
      const token = await tokenFromFreshSignup(ctx, 'verify-tamper');
      const tampered = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);

      const bad = await ctx.request().post('/api/auth/verify-email', { token: tampered });
      expect(bad.status).toBe(422);
      expect((await bad.json()).error).toBe('Invalid verification link');

      const unknown = await ctx.request().post('/api/auth/verify-email', {
        token: createVerificationToken(newId(), uniqueEmail('ghost')),
      });
      expect(unknown.status).toBe(422);
      expect((await unknown.json()).error).toBe('Invalid verification link');
    });

    it('rejects a password-reset token', async () => {
      clearSentEmails();
      const user = await ctx.createUser('verify-crossfamily');
      await ctx.request().post('/api/auth/forgot-password', { email: user.email });
      const resetToken = extractToken(sentEmails().slice(-1)[0].text);

      const res = await ctx.request().post('/api/auth/verify-email', { token: resetToken });
      expect(res.status).toBe(422);
      expect(await verifiedAtOf(user.id)).toBeNull();
    });

    it('does not authenticate: the token is not a bearer credential', async () => {
      const token = await tokenFromFreshSignup(ctx, 'verify-notbearer');
      const res = await ctx.request(token).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/verify-email/resend', () => {
    it('sends one email to the caller’s own address', async () => {
      clearSentEmails();
      const user = await ctx.createUser('resend-ok');
      clearSentEmails();

      const res = await ctx.request(user.token).post('/api/auth/verify-email/resend');
      expect(res.status).toBe(204);
      expect(sentEmails()).toHaveLength(1);
      expect(sentEmails()[0].to).toBe(user.email);
    });

    it('sends nothing once the address is verified', async () => {
      clearSentEmails();
      const user = await ctx.createUser('resend-verified');
      const token = extractToken(sentEmails()[0].text);
      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);

      clearSentEmails();
      const res = await ctx.request(user.token).post('/api/auth/verify-email/resend');
      expect(res.status).toBe(204);
      expect(sentEmails()).toEqual([]);
    });

    it('answers 429 past the per-user budget, having sent exactly the budget', async () => {
      clearSentEmails();
      const user = await ctx.createUser('resend-limit');
      clearSentEmails();

      for (let i = 0; i < VERIFY_USER_MAX_ATTEMPTS; i++) {
        const res = await ctx.request(user.token).post('/api/auth/verify-email/resend');
        expect(res.status).toBe(204);
      }
      expect(sentEmails()).toHaveLength(VERIFY_USER_MAX_ATTEMPTS);

      const throttled = await ctx.request(user.token).post('/api/auth/verify-email/resend');
      expect(throttled.status).toBe(429);
      expect(sentEmails()).toHaveLength(VERIFY_USER_MAX_ATTEMPTS);
    });

    it('requires authentication', async () => {
      const res = await ctx.request().post('/api/auth/verify-email/resend');
      expect(res.status).toBe(401);
      expect(sentEmails()).toEqual([]);
    });
  });

  describe('PATCH /api/auth/me', () => {
    it('clears verification, mails only the new address, and reports email_verified false', async () => {
      clearSentEmails();
      const user = await ctx.createUser('patch-reverify');
      const token = extractToken(sentEmails()[0].text);
      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);
      expect(await verifiedAtOf(user.id)).not.toBeNull();

      clearSentEmails();
      const newEmail = uniqueEmail('patch-reverify-to');
      const res = await ctx.request(user.token).patch('/api/auth/me', { email: newEmail });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: user.id,
        email: newEmail,
        name: user.name,
        avatar_url: null,
        email_verified: false,
      });
      expect(await verifiedAtOf(user.id)).toBeNull();

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(newEmail);
      expect(emails.some((email) => email.to === user.email)).toBe(false);
    });

    it('keeps verification and sends nothing when only the letter case changes', async () => {
      clearSentEmails();
      const user = await ctx.createUser('patch-case');
      const token = extractToken(sentEmails()[0].text);
      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);
      const before = await verifiedAtOf(user.id);

      clearSentEmails();
      const res = await ctx
        .request(user.token)
        .patch('/api/auth/me', { email: user.email.toUpperCase() });

      expect(res.status).toBe(200);
      expect((await res.json()).email_verified).toBe(true);
      expect((await verifiedAtOf(user.id))?.getTime()).toBe(before?.getTime());
      expect(sentEmails()).toEqual([]);
    });

    it('keeps verification and sends nothing on a name-only change', async () => {
      clearSentEmails();
      const user = await ctx.createUser('patch-name-only');
      const token = extractToken(sentEmails()[0].text);
      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);

      clearSentEmails();
      const res = await ctx.request(user.token).patch('/api/auth/me', { name: 'Renamed Verified' });

      expect(res.status).toBe(200);
      expect((await res.json()).email_verified).toBe(true);
      expect(sentEmails()).toEqual([]);
    });

    it('answers 429 and changes nothing when the send budget is spent', async () => {
      clearSentEmails();
      const user = await ctx.createUser('patch-throttled');
      clearSentEmails();

      for (let i = 0; i < VERIFY_USER_MAX_ATTEMPTS; i++) {
        expect((await ctx.request(user.token).post('/api/auth/verify-email/resend')).status).toBe(
          204
        );
      }

      const newEmail = uniqueEmail('patch-throttled-to');
      const res = await ctx.request(user.token).patch('/api/auth/me', { email: newEmail });
      expect(res.status).toBe(429);

      const me = await ctx.request(user.token).get('/api/auth/me');
      expect((await me.json()).email).toBe(user.email);
      expect(sentEmails()).toHaveLength(VERIFY_USER_MAX_ATTEMPTS);
    });
  });

  describe('leak surface', () => {
    it('keeps email_verified out of the user_updated payload', async () => {
      clearSentEmails();
      const user = await ctx.createUser('leak-realtime');
      const token = extractToken(sentEmails()[0].text);
      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);

      const seen: BusEntry[] = [];
      const unsubscribe = subscribeBus((entry) => seen.push(entry));
      try {
        const res = await ctx.request(user.token).patch('/api/auth/me', { name: 'Leak Check' });
        expect(res.status).toBe(200);
      } finally {
        unsubscribe();
      }

      const published = seen.filter((entry) => entry.type === USER_UPDATED);
      expect(published).toHaveLength(1);
      expect(published[0].data).toEqual({
        id: user.id,
        email: user.email,
        name: 'Leak Check',
        avatar_url: null,
      });
    });

    it('keeps email_verified out of every record describing other people', async () => {
      clearSentEmails();
      const owner = await ctx.createUser('leak-owner');
      const member = await ctx.createUser('leak-member');
      const token = extractToken(sentEmails().find((e) => e.to === member.email)!.text);
      expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);

      const projectId = newId();
      expect(
        (
          await ctx
            .request(owner.token)
            .post('/api/projects', { id: projectId, name: 'leak board' })
        ).status
      ).toBe(201);
      expect(
        (
          await ctx
            .request(owner.token)
            .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] })
        ).status
      ).toBe(204);

      const users = await ctx.request(owner.token).get(`/api/users?project_id=${projectId}`);
      expect(users.status).toBe(200);
      const listed = (await users.json()).users as Record<string, unknown>[];
      expect(listed.length).toBeGreaterThan(1);
      for (const entry of listed) {
        expect(Object.keys(entry).sort()).toEqual(['avatar_url', 'email', 'id', 'name']);
      }

      const project = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
      expect(project.status).toBe(200);
      expect(JSON.stringify(await project.json())).not.toContain('email_verified');
    });
  });

  describe('account-access mail is never gated on verification', () => {
    it('still sends a password-reset email to an unverified address', async () => {
      clearSentEmails();
      const user = await ctx.createUser('unverified-reset');
      expect(await verifiedAtOf(user.id)).toBeNull();

      clearSentEmails();
      const res = await ctx.request().post('/api/auth/forgot-password', { email: user.email });
      expect(res.status).toBe(204);

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(user.email);
      expect(emails[0].subject).toContain('password');
    });

    it('still sends feedback mail from an unverified account', async () => {
      clearSentEmails();
      const user = await ctx.createUser('unverified-feedback');
      expect(await verifiedAtOf(user.id)).toBeNull();

      clearSentEmails();
      const res = await ctx
        .request(user.token)
        .post('/api/feedback', { id: newId(), message: 'still reaches the owner' });
      expect(res.status).toBe(201);

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(env.feedbackEmailAddress);
    });
  });
});
