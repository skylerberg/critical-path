import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { app } from '../../../src/index';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { resetRateLimiter } from '../../../src/middleware/rateLimit';
import { env } from '../../../src/config/env';
import { notificationDelivery, type Notification } from '../../../src/services/notifications';
import { createUnsubscribeToken } from '../../../src/services/emailToken';
import { MemoryEmailSender, sentEmails, clearSentEmails } from '../../../src/services/email/index';

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

  async function addMember(userId: string, role?: string): Promise<void> {
    const res = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [userId],
      ...(role === undefined ? {} : { roles: [{ user_id: userId, role }] }),
    });
    expect(res.status).toBe(204);
    await settle();
    clearSentEmails();
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
      .where('id', 'in', [owner.id, member.id, unverified.id])
      .execute();
    await db
      .deleteFrom('project_member')
      .where('project_id', '=', projectId)
      .where('user_id', 'in', [member.id, unverified.id])
      .execute();
    clearSentEmails();
  });

  describe('task_assigned', () => {
    it('mails the newly assigned member with a link to the card', async () => {
      await addMember(member.id);
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
      await addMember(member.id);
      await createTask(owner.token, { assignee_ids: [member.id] });
      await settle();

      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });

    it('sends nothing when the current assignee set is echoed back', async () => {
      await addMember(member.id);
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

    it('sends nothing when a duplicate task id rolls the transaction back', async () => {
      await addMember(member.id);
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

  describe('copying never notifies', () => {
    it('sends nothing when a card assigned to someone else is duplicated', async () => {
      await addMember(member.id);
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
      await addMember(member.id);
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
      await addMember(member.id);

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
      const token = createUnsubscribeToken(member.id, 'task_assigned');

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
      const token = createUnsubscribeToken(member.id, 'task_assigned');

      const res = await ctx.request().post('/api/auth/unsubscribe/all', { token });
      expect(res.status).toBe(204);
      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: false,
      });
    });

    it('accepts the form-encoded one-click post a mail client sends', async () => {
      const token = createUnsubscribeToken(member.id, 'added_to_project');

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
      const token = createUnsubscribeToken(member.id, 'task_assigned');
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
      const token = createUnsubscribeToken(member.id, 'task_assigned');

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
      const token = createUnsubscribeToken(member.id, 'task_assigned');

      const res = await ctx.request().post('/api/auth/unsubscribe/all', { token });
      expect(res.status).toBe(204);

      expect(await settingsOf(member.id)).toEqual({
        task_assigned: false,
        added_to_project: false,
      });
      expect(await settingsOf(owner.id)).toEqual({ task_assigned: true, added_to_project: true });
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

  describe('delivery failure', () => {
    it('leaves the mutation committed when a send throws', async () => {
      await addMember(member.id);
      const task = await createTask(owner.token);
      vi.spyOn(MemoryEmailSender.prototype, 'send').mockRejectedValue(new Error('smtp is down'));

      const res = await ctx
        .request(owner.token)
        .put(`/api/tasks/${task.id}/assignees`, { user_ids: [member.id] });
      expect(res.status).toBe(204);
      await settle();

      const rows = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', task.id)
        .execute();
      expect(rows.map((row) => row.user_id)).toEqual([member.id]);
    });
  });
});
