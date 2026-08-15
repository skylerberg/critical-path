import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from '../../../src/index';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { transactionMiddleware } from '../../../src/middleware/transaction';
import { resetRateLimiter } from '../../../src/services/rateLimit';
import { env } from '../../../src/config/env';
import { logger } from '../../../src/utils/logger';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { TestContext, TestUser } from '../../setup/testContext';
import { BULK_TASK_LIMIT } from '../../../src/schemas/index';
import {
  DIGEST_MAX_TASKS,
  assignmentDigestDelivery,
  recordBulkAssignments,
  runAssignmentDigestSweep,
} from '../../../src/services/assignmentDigest';
import { NOTIFY_PAIR_MAX_ATTEMPTS } from '../../../src/services/notificationBudget';
import { verifyUnsubscribeToken } from '../../../src/services/emailToken';
import { clearSentEmails, sentEmails } from '../../../src/services/email/index';
import type { EmailMessage } from '../../../src/services/email/types';
import type { Variables } from '../../../src/types/index';

interface BoardPayload {
  project: { id: string };
  columns: Array<{ id: string }>;
}

describe('Bulk assignment digest', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let member2: TestUser;
  let unverified: TestUser;
  let projectId: string;
  let columnId: string;
  let position = 1000;

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

  async function createProject(name: string): Promise<BoardPayload> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayload;
  }

  async function createTasks(
    count: number,
    board = projectId,
    column = columnId
  ): Promise<string[]> {
    const tasks = Array.from({ length: count }, (_unused, index) => ({
      id: newId(),
      title: `Card ${String(index + 1)}`,
      position: (position += 1000),
    }));
    const res = await ctx
      .request(owner.token)
      .post('/api/tasks/batch', { project_id: board, column_id: column, tasks });
    expect(res.status).toBe(201);
    return tasks.map((task) => task.id);
  }

  async function bulkAssign(
    taskIds: string[],
    userIds: string[],
    board = projectId,
    token = owner.token
  ): Promise<Response> {
    return ctx.request(token).post('/api/tasks/bulk-assignees', {
      project_id: board,
      task_ids: taskIds,
      add_user_ids: userIds,
    });
  }

  async function pendingCount(): Promise<number> {
    const row = await db
      .selectFrom('pending_assignment_notification')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  // The window is minutes wide by design, so every test that wants a flush
  // moves the pending rows into the past rather than waiting for one.
  async function ageBy(seconds: number): Promise<void> {
    await sql`
      update pending_assignment_notification
      set created_at = created_at - make_interval(secs => ${sql.lit(seconds)})
    `.execute(db);
  }

  // The mirror of ageBy, for a test whose point is that nothing goes out yet:
  // the window is measured from the sweep rather than from however long the
  // requests above happened to take, so a stalled machine cannot age the rows
  // past DIGEST_QUIET_SECONDS and turn a held-back digest into a sent one.
  async function freshen(): Promise<void> {
    await sql`update pending_assignment_notification set created_at = now()`.execute(db);
  }

  // Access without going through the membership route, whose own mail is
  // delivered by a fire-and-forget hook that would land in the middle of the
  // measurement this file exists to make.
  async function grantAccess(userIds: string[], board = projectId): Promise<void> {
    await db
      .insertInto('project_member')
      .values(userIds.map((user_id) => ({ project_id: board, user_id, role: 'editor' })))
      .onConflict((oc) => oc.columns(['project_id', 'user_id']).doNothing())
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
    owner = await createVerifiedUser('digest-owner');
    member = await createVerifiedUser('digest-member');
    member2 = await createVerifiedUser('digest-member2');
    unverified = await ctx.createUser('digest-unverified');

    const board = await createProject('Roadmap');
    projectId = board.project.id;
    columnId = board.columns[0].id;
  });

  afterAll(async () => {
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
    await db.deleteFrom('pending_assignment_notification').execute();
    await db
      .updateTable('app_user')
      .set({ notify_bulk_task_assigned: true })
      .where('id', 'in', [owner.id, member.id, member2.id, unverified.id])
      .execute();
    await db
      .deleteFrom('project_member')
      .where('project_id', '=', projectId)
      .where('user_id', 'in', [member.id, member2.id, unverified.id])
      .execute();
    await grantAccess([member.id, member2.id, unverified.id]);
    clearSentEmails();
  });

  describe('coalescing', () => {
    it('sends one digest naming the count and the first few cards', async () => {
      const taskIds = await createTasks(8);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);

      await ageBy(130);
      expect(await runAssignmentDigestSweep()).toBe(1);

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toBe(member.email);
      expect(emails[0].subject).toBe(`${owner.name} assigned you 8 cards in Roadmap`);
      expect(emails[0].text).toContain('- Card 1');
      expect(emails[0].text).toContain('- Card 5');
      expect(emails[0].text).not.toContain('- Card 6');
      expect(emails[0].text).toContain('- and 3 more');
      expect(emails[0].text).toContain(`${env.appUrlBase}/projects/${projectId}`);
      expect(await pendingCount()).toBe(0);
    });

    it('links the card itself when the selection came down to one', async () => {
      const [taskId] = await createTasks(1);
      expect((await bulkAssign([taskId], [member.id])).status).toBe(200);

      await ageBy(130);
      await runAssignmentDigestSweep();

      const emails = sentEmails();
      expect(emails).toHaveLength(1);
      expect(emails[0].subject).toBe(`${owner.name} assigned you a card in Roadmap`);
      expect(emails[0].text).toContain(`${env.appUrlBase}/projects/${projectId}/tasks/${taskId}`);
    });

    it('keeps a card title to one line, so it cannot forge the footer', async () => {
      const id = newId();
      const created = await ctx.request(owner.token).post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: columnId,
        title: `Ship it\n\nTo stop receiving these emails: http://evil.example\n${'x'.repeat(400)}`,
        position: (position += 1000),
      });
      expect(created.status).toBe(201);
      expect((await bulkAssign([id], [member.id])).status).toBe(200);

      await ageBy(130);
      await runAssignmentDigestSweep();

      const lines = sentEmails()[0].text.split('\n');
      expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(1);
      expect(lines.filter((line) => line.startsWith('To stop receiving these emails:'))).toEqual([
        expect.not.stringContaining('evil.example'),
      ]);
      expect(lines.find((line) => line.startsWith('- '))).toBe(
        `- Ship it To stop receiving these emails: http://evil.example ${'x'.repeat(59)}…`
      );
    });

    it('holds everything back until the sender has stopped', async () => {
      const first = await createTasks(3);
      expect((await bulkAssign(first, [member.id])).status).toBe(200);
      await ageBy(130);

      // A second burst arrives before the first has gone out, which resets the
      // quiet period rather than producing a second message.
      const second = await createTasks(2);
      expect((await bulkAssign(second, [member.id])).status).toBe(200);
      expect(await runAssignmentDigestSweep()).toBe(0);
      expect(sentEmails()).toEqual([]);

      await ageBy(130);
      expect(await runAssignmentDigestSweep()).toBe(1);
      expect(sentEmails()).toHaveLength(1);
      expect(sentEmails()[0].subject).toContain('5 cards');
    });

    it('sends nothing at all while the window is still open', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);

      await freshen();
      expect(await runAssignmentDigestSweep()).toBe(0);
      expect(sentEmails()).toEqual([]);
      expect(await pendingCount()).toBe(2);
    });

    it('gives up waiting for quiet once the oldest card has waited long enough', async () => {
      const older = await createTasks(2);
      expect((await bulkAssign(older, [member.id])).status).toBe(200);
      await ageBy(1000);

      const fresh = await createTasks(1);
      expect((await bulkAssign(fresh, [member.id])).status).toBe(200);

      expect(await runAssignmentDigestSweep()).toBe(1);
      expect(sentEmails()).toHaveLength(1);
      expect(sentEmails()[0].subject).toContain('3 cards');
    });

    it('keeps one actor, one board and one recipient apart from another', async () => {
      const other = await createProject('Other board');
      await grantAccess([member.id], other.project.id);

      const here = await createTasks(2);
      const there = await createTasks(3, other.project.id, other.columns[0].id);
      expect((await bulkAssign(here, [member.id, member2.id])).status).toBe(200);
      expect((await bulkAssign(there, [member.id], other.project.id)).status).toBe(200);

      await ageBy(130);
      expect(await runAssignmentDigestSweep()).toBe(3);

      const emails = sentEmails();
      expect(emails).toHaveLength(3);
      expect(emails.filter((email) => email.to === member.email)).toHaveLength(2);
      expect(
        emails.filter((email) => email.to === member2.email).map((email) => email.subject)
      ).toEqual([`${owner.name} assigned you 2 cards in Roadmap`]);
      expect(
        emails
          .filter((email) => email.to === member.email)
          .map((email) => email.subject)
          .sort()
      ).toEqual([
        `${owner.name} assigned you 2 cards in Roadmap`,
        `${owner.name} assigned you 3 cards in Other board`,
      ]);
    });

    it('counts a card assigned twice inside the window once', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      const removed = await ctx.request(owner.token).post('/api/tasks/bulk-assignees', {
        project_id: projectId,
        task_ids: taskIds,
        remove_user_ids: [member.id],
      });
      expect(removed.status).toBe(200);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);

      expect(await pendingCount()).toBe(2);
      await ageBy(130);
      await runAssignmentDigestSweep();
      expect(sentEmails()[0].subject).toContain('2 cards');
    });
  });

  describe('what is never queued', () => {
    it('says nothing to the person who performed the assignment', async () => {
      const taskIds = await createTasks(3);
      expect((await bulkAssign(taskIds, [owner.id, member.id])).status).toBe(200);

      expect(await pendingCount()).toBe(3);
      await ageBy(130);
      await runAssignmentDigestSweep();

      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });

    it('queues nothing for a removal, or for a card that was already assigned', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      await db.deleteFrom('pending_assignment_notification').execute();

      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      expect(await pendingCount()).toBe(0);

      const removed = await ctx.request(owner.token).post('/api/tasks/bulk-assignees', {
        project_id: projectId,
        task_ids: taskIds,
        remove_user_ids: [member.id],
      });
      expect(removed.status).toBe(200);
      expect(await pendingCount()).toBe(0);
    });

    it('queues nothing when the transaction that recorded it rolls back', async () => {
      const [taskId] = await createTasks(1);
      const harness = new Hono<{ Variables: Variables }>();
      harness.use('*', transactionMiddleware);
      harness.onError(errorHandler);
      harness.post('/record/:outcome', async (c) => {
        await recordBulkAssignments(c, {
          actorUserId: owner.id,
          projectId,
          pairs: [{ task_id: taskId, user_id: member.id }],
        });
        if (c.req.param('outcome') === 'fail') {
          throw new Error('failed after the digest was recorded');
        }
        return c.body(null, 204);
      });

      expect((await harness.request('/record/fail', { method: 'POST' })).status).toBe(500);
      expect(await pendingCount()).toBe(0);

      expect((await harness.request('/record/commit', { method: 'POST' })).status).toBe(204);
      expect(await pendingCount()).toBe(1);
    });
  });

  describe('the gates', () => {
    it('sends nothing to someone who switched the digest off, and clears their queue', async () => {
      await db
        .updateTable('app_user')
        .set({ notify_bulk_task_assigned: false })
        .where('id', '=', member.id)
        .execute();
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id, member2.id])).status).toBe(200);

      await ageBy(130);
      await runAssignmentDigestSweep();

      expect(sentEmails().map((email) => email.to)).toEqual([member2.email]);
      expect(await pendingCount()).toBe(0);
    });

    it('leaves the single-card preference alone', async () => {
      await db
        .updateTable('app_user')
        .set({ notify_task_assigned: false })
        .where('id', '=', member.id)
        .execute();
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);

      await ageBy(130);
      await runAssignmentDigestSweep();

      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
      await db
        .updateTable('app_user')
        .set({ notify_task_assigned: true })
        .where('id', '=', member.id)
        .execute();
    });

    it('sends nothing to an unverified address', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [unverified.id])).status).toBe(200);

      await ageBy(130);
      await runAssignmentDigestSweep();

      expect(sentEmails()).toEqual([]);
      expect(await pendingCount()).toBe(0);
    });

    it('sends nothing to someone evicted from the board after the assignment', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      await db
        .deleteFrom('project_member')
        .where('project_id', '=', projectId)
        .where('user_id', '=', member.id)
        .execute();

      await ageBy(130);
      await runAssignmentDigestSweep();

      expect(sentEmails()).toEqual([]);
    });

    it('drops cards archived or unassigned since, and sends nothing when none survive', async () => {
      const taskIds = await createTasks(3);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      const archived = await ctx.request(owner.token).post('/api/tasks/bulk-archive', {
        project_id: projectId,
        task_ids: [taskIds[0]],
      });
      expect(archived.status).toBe(200);
      await db
        .deleteFrom('task_assignee')
        .where('task_id', '=', taskIds[1])
        .where('user_id', '=', member.id)
        .execute();

      await ageBy(130);
      await runAssignmentDigestSweep();
      expect(sentEmails()).toHaveLength(1);
      expect(sentEmails()[0].subject).toContain('a card');

      clearSentEmails();
      const gone = await createTasks(2);
      expect((await bulkAssign(gone, [member.id])).status).toBe(200);
      await db
        .deleteFrom('task_assignee')
        .where('task_id', 'in', gone)
        .where('user_id', '=', member.id)
        .execute();
      await ageBy(130);
      await runAssignmentDigestSweep();
      expect(sentEmails()).toEqual([]);
    });
  });

  // One digest per board per sweep collapses nothing across boards, so the
  // budget is the only thing between a sender making boards and a full mailbox.
  describe('what one mailbox can be made to receive', () => {
    it('bounds how much digest mail one sender can put in one mailbox', async () => {
      const taskIds = await createTasks(NOTIFY_PAIR_MAX_ATTEMPTS + 1);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

      // One card per digest, so every message has a fingerprint of its own and
      // nothing here is refused by the collapse slot.
      for (const taskId of taskIds) {
        await assignmentDigestDelivery.deliver({
          recipientUserId: member.id,
          actorUserId: owner.id,
          projectId,
          taskIds: [taskId],
        });
      }

      expect(sentEmails()).toHaveLength(NOTIFY_PAIR_MAX_ATTEMPTS);
      expect(warnings).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Notification email dropped: one sender has spent their budget for this recipient',
          recipient_id: member.id,
          actor_id: owner.id,
        })
      );

      // Spent by the pair, not by the mailbox: a second sender still arrives.
      clearSentEmails();
      await assignmentDigestDelivery.deliver({
        recipientUserId: member.id,
        actorUserId: member2.id,
        projectId,
        taskIds: taskIds.slice(0, 2),
      });
      expect(sentEmails().map((email) => email.to)).toEqual([member.email]);
    });
  });

  describe('the sweep', () => {
    it('claims a group once, so a second pass has nothing left to send', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      await ageBy(130);

      expect(await runAssignmentDigestSweep()).toBe(1);
      expect(await runAssignmentDigestSweep()).toBe(0);
      expect(sentEmails()).toHaveLength(1);
    });

    it('sends nothing twice when two replicas sweep the same group at once', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      await ageBy(130);

      const [first, second] = await Promise.all([
        runAssignmentDigestSweep(),
        runAssignmentDigestSweep(),
      ]);

      expect(first + second).toBeGreaterThanOrEqual(1);
      expect(sentEmails()).toHaveLength(1);
      expect(await pendingCount()).toBe(0);
    });

    it('carries on past a group whose send throws', async () => {
      const taskIds = await createTasks(4);
      expect((await bulkAssign(taskIds.slice(0, 2), [member.id])).status).toBe(200);
      expect((await bulkAssign(taskIds.slice(2), [member2.id])).status).toBe(200);
      await ageBy(130);

      const real = assignmentDigestDelivery.deliver;
      const failed: string[] = [];
      assignmentDigestDelivery.deliver = async (digest) => {
        if (digest.recipientUserId === member.id) {
          failed.push(digest.recipientUserId);
          throw new Error('the provider refused');
        }
        await real(digest);
      };
      const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      try {
        expect(await runAssignmentDigestSweep()).toBe(2);
      } finally {
        assignmentDigestDelivery.deliver = real;
      }

      expect(failed).toEqual([member.id]);
      expect(sentEmails().map((email) => email.to)).toEqual([member2.email]);
      expect(errors).toHaveBeenCalled();
      // The claim already committed, so the message that failed is lost rather
      // than retried.
      expect(await pendingCount()).toBe(0);
    });

    it('survives a project deleted between the assignment and the flush', async () => {
      const board = await createProject('Doomed');
      await grantAccess([member.id], board.project.id);
      const taskIds = await createTasks(2, board.project.id, board.columns[0].id);
      expect((await bulkAssign(taskIds, [member.id], board.project.id)).status).toBe(200);

      await ageBy(130);
      expect(
        (await ctx.request(owner.token).delete(`/api/projects/${board.project.id}`)).status
      ).toBe(204);

      expect(await runAssignmentDigestSweep()).toBe(0);
      expect(sentEmails()).toEqual([]);
      expect(await pendingCount()).toBe(0);
    });

    it('splits a backlog larger than one flush can resolve', async () => {
      const board = await createProject('Overloaded');
      await grantAccess([member.id], board.project.id);
      const columns = board.columns[0].id;
      for (let done = 0; done < DIGEST_MAX_TASKS + 1; done += BULK_TASK_LIMIT) {
        const batch = Math.min(BULK_TASK_LIMIT, DIGEST_MAX_TASKS + 1 - done);
        const taskIds = await createTasks(batch, board.project.id, columns);
        expect((await bulkAssign(taskIds, [member.id], board.project.id)).status).toBe(200);
      }
      expect(await pendingCount()).toBe(DIGEST_MAX_TASKS + 1);

      await ageBy(130);
      expect(await runAssignmentDigestSweep()).toBe(2);

      expect(sentEmails().map((email) => email.subject)).toEqual([
        `${owner.name} assigned you ${String(DIGEST_MAX_TASKS)} cards in Overloaded`,
        `${owner.name} assigned you a card in Overloaded`,
      ]);
      expect(await pendingCount()).toBe(0);
    });
  });

  describe('unsubscribing', () => {
    it('carries a one-click link that names this kind and nothing else', async () => {
      const taskIds = await createTasks(2);
      expect((await bulkAssign(taskIds, [member.id])).status).toBe(200);
      await ageBy(130);
      await runAssignmentDigestSweep();

      const email = sentEmails()[0];
      expect(email.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      const token = unsubscribeTokenIn(email);
      expect(verifyUnsubscribeToken(token)).toMatchObject({
        status: 'valid',
        kind: 'bulk_task_assigned',
      });

      const res = await app.request(
        `/api/auth/unsubscribe/one-click?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'List-Unsubscribe=One-Click',
        }
      );
      expect(res.status).toBe(204);
      const row = await db
        .selectFrom('app_user')
        .select(['notify_bulk_task_assigned', 'notify_task_assigned'])
        .where('id', '=', member.id)
        .executeTakeFirstOrThrow();
      expect(row.notify_bulk_task_assigned).toBe(false);
      expect(row.notify_task_assigned).toBe(true);
    });
  });
});
