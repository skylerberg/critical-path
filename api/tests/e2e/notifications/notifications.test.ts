import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../src/index';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { transactionMiddleware } from '../../../src/middleware/transaction';
import {
  NOTIFY_PAIR_MAX_ATTEMPTS,
  NOTIFY_RECIPIENT_MAX_ATTEMPTS,
  NOTIFY_WINDOW_MS,
  resetRateLimiter,
} from '../../../src/middleware/rateLimit';
import { env } from '../../../src/config/env';
import { logger } from '../../../src/utils/logger';
import {
  notificationDelivery,
  notify,
  type Notification,
} from '../../../src/services/notifications';
import { createUnsubscribeToken, verifyUnsubscribeToken } from '../../../src/services/emailToken';
import { MemoryEmailSender, sentEmails, clearSentEmails } from '../../../src/services/email/index';
import type { EmailMessage } from '../../../src/services/email/types';
import type { Variables } from '../../../src/types/index';

interface BoardPayload {
  project: { id: string };
  columns: Array<{ id: string }>;
}

interface SettingsBody {
  task_assigned: boolean;
  added_to_project: boolean;
}

async function settingsOf(userId: string): Promise<SettingsBody> {
  const row = await db
    .selectFrom('app_user')
    .select(['notify_task_assigned', 'notify_added_to_project'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return {
    task_assigned: row.notify_task_assigned,
    added_to_project: row.notify_added_to_project,
  };
}

describe('Notifications', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  const realDeliver = notificationDelivery.deliver;
  let pending: Promise<void>[] = [];
  let owner: TestUser;
  let member: TestUser;
  let member2: TestUser;
  let unverified: TestUser;
  let projectId: string;
  let columnId: string;

  // Post-commit hooks are fire-and-forget, so an assertion about what was sent
  // has to wait for the delivery this request started — including the deliveries
  // that should not have happened.
  async function settle(): Promise<void> {
    const started = pending;
    pending = [];
    await Promise.allSettled(started);
  }

  async function verify(userId: string): Promise<void> {
    await db
      .updateTable('app_user')
      .set({ email_verified_at: new Date() })
      .where('id', '=', userId)
      .execute();
  }

  async function createVerifiedUser(prefix: string): Promise<TestUser> {
    const user = await ctx.createUser(prefix);
    await verify(user.id);
    return user;
  }

  async function createProject(token: string, name: string): Promise<BoardPayload> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayload;
  }

  async function createTask(
    token: string,
    body: Record<string, unknown> = {}
  ): Promise<{ id: string }> {
    const id = newId();
    const res = await ctx.request(token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: columnId,
      title: 'Ship the thing',
      position: 1000,
      ...body,
    });
    expect(res.status).toBe(201);
    return { id };
  }

  async function addMembers(userIds: string[]): Promise<void> {
    const res = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: userIds });
    expect(res.status).toBe(204);
    await settle();
    clearSentEmails();
  }

  // Access without the membership notification, so a test that measures what
  // reaches a mailbox starts from an empty one and an unspent budget.
  async function grantAccess(userIds: string[]): Promise<void> {
    await db
      .insertInto('project_member')
      .values(userIds.map((user_id) => ({ project_id: projectId, user_id, role: 'editor' })))
      .execute();
  }

  function unsubscribeTokenIn(email: EmailMessage): string {
    const header = email.headers?.['List-Unsubscribe'] ?? '';
    const token = new URL(header.slice(1, -1)).searchParams.get('token');
    expect(token).not.toBeNull();
    return token ?? '';
  }

  beforeAll(async () => {
    process.env.EMAIL_DRIVER = 'memory';
    notificationDelivery.deliver = (notification: Notification) => {
      const promise = realDeliver(notification);
      pending.push(promise);
      return promise;
    };

    owner = await createVerifiedUser('notify-owner');
    member = await createVerifiedUser('notify-member');
    member2 = await createVerifiedUser('notify-member2');
    unverified = await ctx.createUser('notify-unverified');

    const board = await createProject(owner.token, 'Notify board');
    projectId = board.project.id;
    columnId = board.columns[0].id;
  });

  afterAll(async () => {
    notificationDelivery.deliver = realDeliver;
    delete process.env.EMAIL_DRIVER;
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
    resetRateLimiter();
  });

  beforeEach(async () => {
    resetRateLimiter();
    vi.restoreAllMocks();
    pending = [];
    await db
      .updateTable('app_user')
      .set({ notify_task_assigned: true, notify_added_to_project: true })
      .where('id', 'in', [owner.id, member.id, member2.id, unverified.id])
      .execute();
    await db
      .deleteFrom('project_member')
      .where('project_id', '=', projectId)
      .where('user_id', 'in', [member.id, member2.id, unverified.id])
      .execute();
    clearSentEmails();
  });

  describe('task_assigned', () => {
    it('mails the newly assigned member with a link to the card', async () => {
      await addMembers([member.id]);
      const task = await createTask(owner.token);

      const res = await ctx
        .request(owner.token)
        .put(`/api/tasks/${task.id}/assignees`, { user_ids: [member.id] });
      expect(res.status).toBe(204);
      await settle();

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(member.email);
      expect(emails[0].subject).toContain('Ship the thing');
      expect(emails[0].text).toContain(`${env.appUrlBase}/projects/${projectId}/tasks/${task.id}`);
    });

    it('mails an assignee supplied at task creation', async () => {
      await addMembers([member.id]);
      await createTask(owner.token, { assignee_ids: [member.id] });
      await settle();

      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });

    it('sends nothing when the current assignee set is echoed back', async () => {
      await addMembers([member.id]);
      const task = await createTask(owner.token, { assignee_ids: [member.id] });
      await settle();
      clearSentEmails();

      const res = await ctx
        .request(owner.token)
        .put(`/api/tasks/${task.id}/assignees`, { user_ids: [member.id] });
      expect(res.status).toBe(204);
      await settle();

      expect(sentEmails()).toEqual([]);
    });

    it('sends nothing when you assign yourself', async () => {
      const task = await createTask(owner.token);

      const res = await ctx
        .request(owner.token)
        .put(`/api/tasks/${task.id}/assignees`, { user_ids: [owner.id] });
      expect(res.status).toBe(204);
      await settle();

      expect(sentEmails()).toEqual([]);
    });

    it('sends nothing when a duplicate task id is refused before the notification', async () => {
      await addMembers([member.id]);
      const id = newId();
      await createTask(owner.token, { assignee_ids: [member.id] });
      await settle();
      clearSentEmails();

      const first = await ctx.request(owner.token).post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: columnId,
        title: 'first',
        position: 2000,
      });
      expect(first.status).toBe(201);

      const clash = await ctx.request(owner.token).post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: columnId,
        title: 'clash',
        position: 3000,
        assignee_ids: [member.id],
      });
      expect(clash.status).toBe(409);
      await settle();

      expect(sentEmails()).toEqual([]);
    });
  });

  describe('the post-commit boundary', () => {
    // The routes all reach notify() last, so the only way to observe the
    // rollback rule is a handler that fails after it.
    function notifyThenMaybeFail(): Hono<{ Variables: Variables }> {
      const harness = new Hono<{ Variables: Variables }>();
      harness.use('*', transactionMiddleware);
      harness.onError(errorHandler);
      harness.post('/notify/:outcome', async (c) => {
        await notify(c, {
          kind: 'added_to_project',
          actor: owner,
          project: { id: projectId, name: 'Notify board', created_by: owner.id },
          recipientUserIds: [member.id],
        });
        if (c.req.param('outcome') === 'fail') {
          throw new Error('failed after the notification was queued');
        }
        return c.body(null, 204);
      });
      return harness;
    }

    it('mails nobody when the mutation rolls back after notify()', async () => {
      await grantAccess([member.id]);
      const harness = notifyThenMaybeFail();

      const rolledBack = await harness.request('/notify/fail', { method: 'POST' });
      expect(rolledBack.status).toBe(500);
      await settle();
      expect(sentEmails()).toEqual([]);

      // The same notification down the committing path, so the empty inbox
      // above cannot be passing because nothing was ever queued.
      const committed = await harness.request('/notify/commit', { method: 'POST' });
      expect(committed.status).toBe(204);
      await settle();
      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });
  });

  describe('copying never notifies', () => {
    it('sends nothing when a card assigned to someone else is duplicated', async () => {
      await addMembers([member.id]);
      const task = await createTask(owner.token, { assignee_ids: [member.id] });
      await settle();
      clearSentEmails();

      const copyId = newId();
      const res = await ctx
        .request(owner.token)
        .post(`/api/tasks/${task.id}/duplicate`, { id: copyId, position: 5000 });
      expect(res.status).toBe(201);
      await settle();

      expect(sentEmails()).toEqual([]);
      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', copyId)
        .execute();
      expect(assignees.map((row) => row.user_id)).toEqual([member.id]);
    });

    it('sends nothing when a whole board is copied', async () => {
      await addMembers([member.id]);
      await createTask(owner.token, { assignee_ids: [member.id] });
      await settle();
      clearSentEmails();

      const copyId = newId();
      projectIds.push(copyId);
      const res = await ctx
        .request(owner.token)
        .post('/api/projects', { id: copyId, name: 'copy', source_project_id: projectId });
      expect(res.status).toBe(201);
      await settle();

      expect(sentEmails()).toEqual([]);
    });
  });

  describe('added_to_project', () => {
    it('mails a member the moment they gain access', async () => {
      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
      expect(res.status).toBe(204);
      await settle();

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(member.email);
      expect(emails[0].subject).toContain('Notify board');
      expect(emails[0].text).toContain(`${env.appUrlBase}/projects/${projectId}`);
    });

    it('mails on a by-email add, and never again for the same member', async () => {
      const first = await ctx
        .request(owner.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: member.email });
      expect(first.status).toBe(200);
      await settle();
      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);

      clearSentEmails();
      const again = await ctx
        .request(owner.token)
        .post(`/api/projects/${projectId}/members/by-email`, {
          email: member.email,
          role: 'viewer',
        });
      expect(again.status).toBe(200);
      await settle();
      expect(sentEmails()).toEqual([]);
    });

    it('sends nothing for a role change or a removal', async () => {
      await addMembers([member.id]);

      const demote = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [member.id],
        roles: [{ user_id: member.id, role: 'viewer' }],
      });
      expect(demote.status).toBe(204);
      await settle();
      expect(sentEmails()).toEqual([]);

      const remove = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [] });
      expect(remove.status).toBe(204);
      await settle();
      expect(sentEmails()).toEqual([]);
    });

    it('sends nothing when ownership is transferred to an existing member', async () => {
      const board = await createProject(owner.token, 'Handover board');
      const handoverId = board.project.id;
      const add = await ctx
        .request(owner.token)
        .put(`/api/projects/${handoverId}/members`, { user_ids: [member.id] });
      expect(add.status).toBe(204);
      await settle();
      clearSentEmails();

      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${handoverId}/owner`, { user_id: member.id });
      expect(res.status).toBe(200);
      await settle();

      expect(sentEmails()).toEqual([]);
    });
  });

  describe('the verified gate', () => {
    it('sends nothing to an unverified recipient but still performs the write', async () => {
      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [unverified.id] });
      expect(res.status).toBe(204);
      await settle();

      expect(sentEmails()).toEqual([]);
      const rows = await db
        .selectFrom('project_member')
        .select('user_id')
        .where('project_id', '=', projectId)
        .where('user_id', '=', unverified.id)
        .execute();
      expect(rows).toHaveLength(1);
    });

    it('is applied per recipient, so one unverified address never silences the rest', async () => {
      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id, unverified.id] });
      expect(res.status).toBe(204);
      await settle();

      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });
  });

  describe('preferences', () => {
    it('defaults both kinds on and round-trips a change', async () => {
      const initial = await ctx.request(member.token).get('/api/auth/me/notification-settings');
      expect(initial.status).toBe(200);
      expect(await initial.json()).toEqual({ task_assigned: true, added_to_project: true });

      const saved = await ctx.request(member.token).put('/api/auth/me/notification-settings', {
        task_assigned: false,
        added_to_project: true,
      });
      expect(saved.status).toBe(200);
      expect(await saved.json()).toEqual({ task_assigned: false, added_to_project: true });
      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: true,
      });
    });

    it('requires a bearer token, so no unauthenticated request can switch one on', async () => {
      const read = await ctx.request().get('/api/auth/me/notification-settings');
      expect(read.status).toBe(401);

      const write = await ctx.request().put('/api/auth/me/notification-settings', {
        task_assigned: true,
        added_to_project: true,
      });
      expect(write.status).toBe(401);
    });

    it('gates each kind independently', async () => {
      await ctx.request(member.token).put('/api/auth/me/notification-settings', {
        task_assigned: false,
        added_to_project: true,
      });

      const add = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
      expect(add.status).toBe(204);
      await settle();
      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);

      clearSentEmails();
      const task = await createTask(owner.token);
      const assign = await ctx
        .request(owner.token)
        .put(`/api/tasks/${task.id}/assignees`, { user_ids: [member.id] });
      expect(assign.status).toBe(204);
      await settle();
      expect(sentEmails()).toEqual([]);
    });
  });

  describe('unsubscribe', () => {
    it('switches off the kind the token names, and is idempotent', async () => {
      const token = createUnsubscribeToken(member.id, member.email, 'task_assigned');

      const first = await ctx.request().post('/api/auth/unsubscribe', { token });
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ kind: 'task_assigned' });
      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: true,
      });

      const second = await ctx.request().post('/api/auth/unsubscribe', { token });
      expect(second.status).toBe(200);
      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: true,
      });
    });

    it('switches everything off through the all form', async () => {
      const token = createUnsubscribeToken(member.id, member.email, 'task_assigned');

      const res = await ctx.request().post('/api/auth/unsubscribe/all', { token });
      expect(res.status).toBe(204);
      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: false,
      });
    });

    it('accepts the form-encoded one-click post a mail client sends', async () => {
      const token = createUnsubscribeToken(member.id, member.email, 'added_to_project');

      const res = await app.request(
        `/api/auth/unsubscribe/one-click?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
        }
      );
      expect(res.status).toBe(204);
      expect(await settingsOf(member.id)).toEqual({
        task_assigned: true,
        added_to_project: false,
      });
    });

    it('answers 422 for a tampered, foreign or missing token without touching anything', async () => {
      const token = createUnsubscribeToken(member.id, member.email, 'task_assigned');
      const [payload, signature] = token.split('.');
      const tampered = `${payload}.${(signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)}`;

      for (const bad of [tampered, 'not-a-token', '']) {
        const res = await ctx.request().post('/api/auth/unsubscribe', { token: bad });
        expect(res.status).toBe(422);
      }

      const oneClick = await app.request('/api/auth/unsubscribe/one-click', { method: 'POST' });
      expect(oneClick.status).toBe(422);

      expect(await settingsOf(member.id)).toEqual({ task_assigned: true, added_to_project: true });
    });

    it('never authenticates a session', async () => {
      const token = createUnsubscribeToken(member.id, member.email, 'task_assigned');

      const me = await ctx.request(token).get('/api/auth/me');
      expect(me.status).toBe(401);
      // The same requests with a real credential, so the 401s above cannot be
      // passing for some unrelated reason.
      expect((await ctx.request(member.token).get('/api/auth/me')).status).toBe(200);

      const body = { task_assigned: true, added_to_project: true };
      expect(
        (await ctx.request(token).put('/api/auth/me/notification-settings', body)).status
      ).toBe(401);
      expect(
        (await ctx.request(member.token).put('/api/auth/me/notification-settings', body)).status
      ).toBe(200);
    });

    it("cannot reach another account's settings", async () => {
      const token = createUnsubscribeToken(member.id, member.email, 'task_assigned');

      const res = await ctx.request().post('/api/auth/unsubscribe/all', { token });
      expect(res.status).toBe(204);

      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: false,
      });
      expect(await settingsOf(owner.id)).toEqual({ task_assigned: true, added_to_project: true });
    });

    it('stops working once the account moves to a different address', async () => {
      const mover = await createVerifiedUser('notify-mover');
      const stale = createUnsubscribeToken(mover.id, mover.email, 'task_assigned');

      const newAddress = `moved-${newId()}@test.example.com`;
      const moved = await ctx.request(mover.token).patch('/api/auth/me', { email: newAddress });
      expect(moved.status).toBe(200);
      await settle();
      clearSentEmails();

      // Answered exactly as a live link is, so a dead link is not an oracle.
      const single = await ctx.request().post('/api/auth/unsubscribe', { token: stale });
      expect(single.status).toBe(200);
      expect(await single.json()).toEqual({ kind: 'task_assigned' });
      const all = await ctx.request().post('/api/auth/unsubscribe/all', { token: stale });
      expect(all.status).toBe(204);
      expect(await settingsOf(mover.id)).toEqual({ task_assigned: true, added_to_project: true });

      // The same call with a link naming the address the account is on now, so
      // the no-ops above cannot be passing for an unrelated reason.
      const fresh = createUnsubscribeToken(mover.id, newAddress, 'task_assigned');
      expect((await ctx.request().post('/api/auth/unsubscribe', { token: fresh })).status).toBe(
        200
      );
      expect(await settingsOf(mover.id)).toEqual({ task_assigned: false, added_to_project: true });
    });
  });

  describe('the mailed unsubscribe link', () => {
    it('names its own recipient and its own kind, for every recipient of one send', async () => {
      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id, member2.id] });
      expect(res.status).toBe(204);
      await settle();

      const emails = sentEmails();
      expect(emails.map((email) => email.to).sort()).toEqual([member.email, member2.email].sort());

      const expectedId = new Map([
        [member.email, member.id],
        [member2.email, member2.id],
      ]);
      for (const email of emails) {
        expect(verifyUnsubscribeToken(unsubscribeTokenIn(email))).toEqual({
          status: 'valid',
          user_id: expectedId.get(email.to),
          email_hash: expect.any(String),
          kind: 'added_to_project',
        });
        expect(email.text).toContain(
          `${env.appUrlBase}/unsubscribe?token=${encodeURIComponent(unsubscribeTokenIn(email))}`
        );
      }
    });

    it('is redeemable by its own recipient and moves only that account', async () => {
      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id, member2.id] });
      expect(res.status).toBe(204);
      await settle();

      const mine = sentEmails().filter((email) => email.to === member2.email);
      expect(mine).toHaveLength(1);
      const redeemed = await ctx
        .request()
        .post('/api/auth/unsubscribe', { token: unsubscribeTokenIn(mine[0]) });
      expect(redeemed.status).toBe(200);

      expect(await settingsOf(member2.id)).toEqual({
        task_assigned: true,
        added_to_project: false,
      });
      expect(await settingsOf(member.id)).toEqual({ task_assigned: true, added_to_project: true });
    });
  });

  describe('headers', () => {
    it('carries the one-click headers on notification mail and on nothing else', async () => {
      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
      expect(res.status).toBe(204);
      await settle();

      const notification = sentEmails()[0];
      expect(notification.headers?.['List-Unsubscribe']).toMatch(
        /^<http.*\/api\/auth\/unsubscribe\/one-click\?token=.+>$/
      );
      expect(notification.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(notification.text).toContain(`${env.appUrlBase}/unsubscribe?token=`);

      clearSentEmails();
      const forgot = await ctx.request().post('/api/auth/forgot-password', { email: member.email });
      expect(forgot.status).toBe(204);
      const resend = await ctx.request(unverified.token).post('/api/auth/verify-email/resend');
      expect(resend.status).toBe(204);

      const transactional = sentEmails();
      expect(transactional).toHaveLength(2);
      for (const email of transactional) {
        expect(email.headers).toBeUndefined();
      }
    });
  });

  describe('what one mailbox can be made to receive', () => {
    async function deliverAbout(
      taskId: string,
      recipientUserIds: string[],
      actorId = owner.id
    ): Promise<void> {
      await realDeliver({
        kind: 'task_assigned',
        actor: { id: actorId, name: 'Owner' },
        project: { id: projectId, name: 'Notify board', created_by: owner.id },
        task: { id: taskId, title: `Card ${taskId}` },
        recipientUserIds,
      });
    }

    it('mails the same person about the same thing once, however often it is redone', async () => {
      for (let round = 0; round < 4; round++) {
        const add = await ctx
          .request(owner.token)
          .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
        expect(add.status).toBe(204);
        await settle();

        const remove = await ctx
          .request(owner.token)
          .put(`/api/projects/${projectId}/members`, { user_ids: [] });
        expect(remove.status).toBe(204);
        await settle();
      }

      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });

    it('bounds what one sender can put in one mailbox without touching anyone else', async () => {
      await grantAccess([member.id, member2.id]);

      for (let index = 0; index < NOTIFY_PAIR_MAX_ATTEMPTS + 5; index++) {
        await deliverAbout(`card-${String(index)}`, [member.id]);
      }
      expect(sentEmails()).toHaveLength(NOTIFY_PAIR_MAX_ATTEMPTS);

      clearSentEmails();
      await deliverAbout('card-0', [member2.id]);
      expect(sentEmails().map((email) => email.to)).toEqual([member2.email]);
    });

    it('collapses a repeat whoever performs it', async () => {
      await grantAccess([member.id]);

      await deliverAbout('shared-card', [member.id], owner.id);
      expect(sentEmails()).toHaveLength(1);

      // A second actor, so the collapse cannot be coming from the sender budget:
      // alternating who performs the write must not make the message look new.
      clearSentEmails();
      await deliverAbout('shared-card', [member.id], member2.id);
      expect(sentEmails()).toEqual([]);
    });

    it('still bounds the total across many senders, and says so once', async () => {
      await grantAccess([member.id]);
      const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      const senders = NOTIFY_RECIPIENT_MAX_ATTEMPTS / NOTIFY_PAIR_MAX_ATTEMPTS;
      for (let sender = 0; sender < senders; sender++) {
        for (let index = 0; index < NOTIFY_PAIR_MAX_ATTEMPTS; index++) {
          await deliverAbout(
            `card-${String(sender)}-${String(index)}`,
            [member.id],
            `s-${String(sender)}`
          );
        }
      }
      expect(sentEmails()).toHaveLength(NOTIFY_RECIPIENT_MAX_ATTEMPTS);

      clearSentEmails();
      await deliverAbout('one-more', [member.id], 'a-fresh-sender');
      await deliverAbout('and-another', [member.id], 'another-fresh-sender');
      expect(sentEmails()).toEqual([]);

      const silenced = warnings.mock.calls.filter(
        ([fields]) =>
          fields.msg === 'Notification email dropped: this recipient is over their total budget'
      );
      expect(silenced).toHaveLength(1);
      expect(silenced[0][0]).toMatchObject({ recipient_id: member.id });
    });

    it('lets one write mail everyone it names', async () => {
      await grantAccess([member.id, member2.id]);

      await deliverAbout('shared-card', [member.id, member2.id]);

      expect(
        sentEmails()
          .map((email) => email.to)
          .sort()
      ).toEqual([member.email, member2.email].sort());
    });

    it('lets a stranger spend only their own budget, so genuine mail still arrives', async () => {
      const attacker = await createVerifiedUser('notify-attacker');
      const victim = await createVerifiedUser('notify-victim');
      const boss = await createVerifiedUser('notify-boss');
      clearSentEmails();
      const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      async function addVictim(token: string, id: string): Promise<void> {
        const res = await ctx
          .request(token)
          .post(`/api/projects/${id}/members/by-email`, { email: victim.email });
        expect(res.status).toBe(200);
        await settle();
      }

      // Boards the victim has never heard of, from an account that shares no
      // project with them and needed their consent for none of it. Each one is a
      // fresh repeat key, so nothing collapses them.
      for (let index = 0; index < NOTIFY_PAIR_MAX_ATTEMPTS; index++) {
        const junk = await createProject(attacker.token, `Junk ${String(index)}`);
        await addVictim(attacker.token, junk.project.id);
      }
      expect(sentEmails()).toHaveLength(NOTIFY_PAIR_MAX_ATTEMPTS);

      clearSentEmails();
      const extra = await createProject(attacker.token, 'Junk extra');
      await addVictim(attacker.token, extra.project.id);
      expect(sentEmails()).toEqual([]);
      expect(warnings).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Notification email dropped: one sender has spent their budget for this recipient',
          recipient_id: victim.id,
          actor_id: attacker.id,
        })
      );

      clearSentEmails();
      const real = await createProject(boss.token, 'Real board');
      await addVictim(boss.token, real.project.id);
      expect(sentEmails().map((email) => email.to)).toEqual([victim.email]);

      clearSentEmails();
      const created = await ctx.request(boss.token).post('/api/tasks', {
        id: newId(),
        project_id: real.project.id,
        column_id: real.columns[0].id,
        title: 'Ship the release',
        position: 1000,
        assignee_ids: [victim.id],
      });
      expect(created.status).toBe(201);
      await settle();

      expect(sentEmails().map((email) => email.to)).toEqual([victim.email]);
    });

    it('leaves a refused message re-sendable once the budget frees', async () => {
      await grantAccess([member.id]);
      const start = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start);

      for (let index = 0; index < NOTIFY_PAIR_MAX_ATTEMPTS; index++) {
        await deliverAbout(`card-${String(index)}`, [member.id]);
      }
      expect(sentEmails()).toHaveLength(NOTIFY_PAIR_MAX_ATTEMPTS);

      // Late in the window: a collapse slot spent here would outlive the budget
      // that refused the message, and nothing re-sends it.
      clearSentEmails();
      clock.mockReturnValue(start + NOTIFY_WINDOW_MS - 10 * 60_000);
      await deliverAbout('urgent', [member.id]);
      expect(sentEmails()).toEqual([]);

      clock.mockReturnValue(start + NOTIFY_WINDOW_MS + 60_000);
      await deliverAbout('urgent', [member.id]);
      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });

    it('sends nothing to a recipient whose access is gone by the time the hook runs', async () => {
      await grantAccess([member.id, member2.id]);
      await db
        .deleteFrom('project_member')
        .where('project_id', '=', projectId)
        .where('user_id', '=', member.id)
        .execute();

      await realDeliver({
        kind: 'added_to_project',
        actor: owner,
        project: { id: projectId, name: 'Notify board', created_by: owner.id },
        recipientUserIds: [member.id, member2.id],
      });

      expect(sentEmails().map((email) => email.to)).toEqual([member2.email]);
    });
  });

  describe('delivery failure', () => {
    it('leaves the mutation committed, mails everyone queued behind it, and logs', async () => {
      await addMembers([member.id, member2.id]);
      const task = await createTask(owner.token);
      const errors = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const realSend = MemoryEmailSender.prototype.send;
      const passthrough = new MemoryEmailSender();
      vi.spyOn(MemoryEmailSender.prototype, 'send').mockImplementation(
        async (message: EmailMessage) => {
          if (message.to === member.email) {
            throw new Error('smtp is down');
          }
          await realSend.call(passthrough, message);
        }
      );

      const res = await ctx
        .request(owner.token)
        .put(`/api/tasks/${task.id}/assignees`, { user_ids: [member.id, member2.id] });
      expect(res.status).toBe(204);
      await settle();

      expect(sentEmails().map((email) => email.to)).toEqual([member2.email]);
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({ msg: 'Notification email failed', kind: 'task_assigned' })
      );
      // The hook itself must not have rejected, or the middleware would have
      // logged its own failure on top.
      expect(errors).toHaveBeenCalledTimes(1);

      const rows = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', task.id)
        .execute();
      expect(rows.map((row) => row.user_id).sort()).toEqual([member.id, member2.id].sort());
    });
  });
});
