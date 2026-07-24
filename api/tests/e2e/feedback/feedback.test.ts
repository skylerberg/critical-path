import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { sentEmails, clearSentEmails } from '../../../src/services/email/index';
import { env } from '../../../src/config/env';

describe('Feedback API', () => {
  const ctx = new TestContext();
  let user: TestUser;

  beforeAll(async () => {
    process.env.EMAIL_DRIVER = 'memory';
    user = await ctx.createUser('feedback');
  });

  afterAll(async () => {
    delete process.env.EMAIL_DRIVER;
    await ctx.cleanup();
  });

  beforeEach(() => {
    clearSentEmails();
  });

  describe('POST /api/feedback', () => {
    it('requires auth', async () => {
      const res = await ctx.request().post('/api/feedback', { id: newId(), message: 'Hi' });
      expect(res.status).toBe(401);
      expect(sentEmails()).toEqual([]);
    });

    it('stores the feedback row and returns 201', async () => {
      const id = newId();
      const res = await ctx.request(user.token).post('/api/feedback', {
        id,
        message: 'The board is great',
        page_path: '/projects/abc',
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; created_at: string };
      expect(body.id).toBe(id);
      expect(new Date(body.created_at).getTime()).not.toBeNaN();

      const row = await db
        .selectFrom('feedback')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      expect(row).toMatchObject({
        id,
        user_id: user.id,
        message: 'The board is great',
        page_path: '/projects/abc',
      });
      expect(row?.created_at.toISOString()).toBe(body.created_at);
    });

    it('emails the feedback to the configured address', async () => {
      const res = await ctx.request(user.token).post('/api/feedback', {
        id: newId(),
        message: 'Please add dark mode',
        page_path: '/account',
      });
      expect(res.status).toBe(201);

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(env.feedbackEmailAddress);
      expect(emails[0].subject).toContain(user.name);
      expect(emails[0].subject).toContain(user.email);
      expect(emails[0].text).toContain('Please add dark mode');
      expect(emails[0].text).toContain('/account');
      expect(emails[0].text).toContain(user.id);
    });

    it('returns 409 for a duplicate id and sends no second email', async () => {
      const id = newId();
      const first = await ctx.request(user.token).post('/api/feedback', { id, message: 'First' });
      expect(first.status).toBe(201);
      clearSentEmails();

      const res = await ctx.request(user.token).post('/api/feedback', { id, message: 'Second' });
      expect(res.status).toBe(409);
      expect(sentEmails()).toEqual([]);
    });

    it('rejects an empty or whitespace-only message with 422', async () => {
      for (const message of ['', '   ']) {
        const res = await ctx.request(user.token).post('/api/feedback', { id: newId(), message });
        expect(res.status).toBe(422);
        const body = (await res.json()) as { error: string; details: { path: string }[] };
        expect(body.error).toBe('Validation failed');
        expect(body.details.some((d) => d.path === 'message')).toBe(true);
      }
      expect(sentEmails()).toEqual([]);
    });

    it('rejects a message over 10000 characters with 422', async () => {
      const res = await ctx.request(user.token).post('/api/feedback', {
        id: newId(),
        message: 'x'.repeat(10001),
      });
      expect(res.status).toBe(422);
      expect(sentEmails()).toEqual([]);
    });

    it('normalizes an empty page_path to null', async () => {
      const id = newId();
      const res = await ctx.request(user.token).post('/api/feedback', {
        id,
        message: 'No path attached',
        page_path: '',
      });
      expect(res.status).toBe(201);

      const row = await db
        .selectFrom('feedback')
        .select('page_path')
        .where('id', '=', id)
        .executeTakeFirst();
      expect(row).toEqual({ page_path: null });
    });
  });
});
