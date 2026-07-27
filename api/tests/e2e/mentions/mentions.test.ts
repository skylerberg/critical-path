import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { TestContext, TestUser } from '../../setup/testContext';
import { db, waitForLockWaiters } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { transactionMiddleware } from '../../../src/middleware/transaction';
import {
  MAX_MENTION_RECIPIENTS,
  mentionDelivery,
  notifyMentions,
} from '../../../src/services/mentions';
import type { MentionNotification } from '../../../src/services/mentions';
import type { Variables } from '../../../src/types/index';

interface BoardPayload {
  project: { id: string };
  columns: Array<{ id: string; name: string }>;
}

interface TaskBody {
  id: string;
  title: string;
  description: unknown;
  updated_at: string;
}

interface CommentBody {
  id: string;
  task_id: string;
  body: unknown;
}

function mentionNode(userId: string, label = 'Someone'): Record<string, unknown> {
  return { type: 'mention', attrs: { id: userId, label, mentionSuggestionChar: '@' } };
}

function mentionDoc(...userIds: string[]): Record<string, unknown> {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'cc ' }, ...userIds.map((id) => mentionNode(id))],
      },
    ],
  };
}

function textDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

describe('Mentions', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  const delivered: MentionNotification[] = [];
  // One more member than the cap, inserted directly because signup hashes a
  // password each time.
  const crowd = Array.from({ length: MAX_MENTION_RECIPIENTS + 1 }, () => newId());
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let columnId: string;

  async function createTask(
    token: string,
    description: Record<string, unknown> | null
  ): Promise<TaskBody> {
    const res = await ctx.request(token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'mention task',
      position: 1000,
      description,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as TaskBody;
  }

  async function patchTask(
    token: string,
    taskId: string,
    body: Record<string, unknown>
  ): Promise<TaskBody> {
    const res = await ctx.request(token).patch(`/api/tasks/${taskId}`, body);
    expect(res.status).toBe(200);
    return (await res.json()) as TaskBody;
  }

  async function postComment(
    token: string,
    taskId: string,
    body: Record<string, unknown>
  ): Promise<CommentBody> {
    const res = await ctx
      .request(token)
      .post('/api/comments', { id: newId(), task_id: taskId, body });
    expect(res.status).toBe(201);
    return (await res.json()) as CommentBody;
  }

  beforeAll(async () => {
    owner = await ctx.createUser('mention-owner');
    member = await ctx.createUser('mention-member');
    outsider = await ctx.createUser('mention-outsider');

    projectId = newId();
    projectIds.push(projectId);
    const res = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'Mention project' });
    expect(res.status).toBe(201);
    const board = (await res.json()) as BoardPayload;
    columnId = board.columns[0].id;
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: member.id })
      .execute();

    await db
      .insertInto('app_user')
      .values(
        crowd.map((id) => ({
          id,
          email: uniqueEmail('mention-crowd'),
          name: 'mention crowd user',
          password_hash: 'unusable',
        }))
      )
      .execute();
    await db
      .insertInto('project_member')
      .values(crowd.map((id) => ({ project_id: projectId, user_id: id })))
      .execute();

    mentionDelivery.deliver = async (notification) => {
      delivered.push(notification);
    };
  });

  beforeEach(() => {
    delivered.length = 0;
  });

  afterAll(async () => {
    mentionDelivery.deliver = async () => {};
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await db.deleteFrom('app_user').where('id', 'in', crowd).execute();
    await ctx.cleanup();
  });

  describe('task descriptions', () => {
    it('resolves one mention added by a new task', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      expect(delivered).toEqual([
        {
          actorUserId: owner.id,
          projectId,
          taskId: task.id,
          source: 'description',
          recipientUserIds: [member.id],
        },
      ]);
    });

    it('resolves only the mention an edit adds', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      await patchTask(member.token, task.id, {
        description: mentionDoc(member.id, outsider.id, owner.id),
      });
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        actorUserId: member.id,
        recipientUserIds: [owner.id],
      });
    });

    it('sends nothing when the same description is saved again', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      await patchTask(owner.token, task.id, { description: mentionDoc(member.id) });
      expect(delivered).toEqual([]);
    });

    it('sends nothing for a patch that only changes the title', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      await patchTask(owner.token, task.id, { title: 'renamed' });
      expect(delivered).toEqual([]);
    });

    it('sends nothing when a mention is removed', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      await patchTask(owner.token, task.id, { description: textDoc('never mind') });
      expect(delivered).toEqual([]);
    });

    it('sends nothing for a self-mention but still resolves the others', async () => {
      await createTask(owner.token, mentionDoc(owner.id));
      expect(delivered).toEqual([]);

      await createTask(owner.token, mentionDoc(owner.id, member.id));
      expect(delivered).toHaveLength(1);
      expect(delivered[0].recipientUserIds).toEqual([member.id]);
    });

    it('resolves one recipient when the same person is mentioned three times', async () => {
      await createTask(owner.token, mentionDoc(member.id, member.id, member.id));
      expect(delivered).toHaveLength(1);
      expect(delivered[0].recipientUserIds).toEqual([member.id]);
    });

    it('resolves a member named by an upper-cased id', async () => {
      await createTask(owner.token, mentionDoc(member.id.toUpperCase()));
      expect(delivered).toHaveLength(1);
      expect(delivered[0].recipientUserIds).toEqual([member.id]);
    });

    it('sends nothing when a re-save only changes the casing of an id', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      await patchTask(owner.token, task.id, { description: mentionDoc(member.id.toUpperCase()) });
      expect(delivered).toEqual([]);
    });

    // A pasted paragraph of foreign chips must not swallow the real mention
    // typed after it.
    it('resolves a member named after a capful of unreachable ids', async () => {
      const unreachable = Array.from({ length: MAX_MENTION_RECIPIENTS }, () => newId());
      await createTask(owner.token, mentionDoc(...unreachable, member.id));
      expect(delivered).toHaveLength(1);
      expect(delivered[0].recipientUserIds).toEqual([member.id]);
    });

    it('resolves at most MAX_MENTION_RECIPIENTS people from one write', async () => {
      await createTask(owner.token, mentionDoc(...crowd));
      expect(delivered).toHaveLength(1);
      expect(delivered[0].recipientUserIds).toHaveLength(MAX_MENTION_RECIPIENTS);
      expect(delivered[0].recipientUserIds.every((id) => crowd.includes(id))).toBe(true);
    });

    it('stores a mention of someone without project access and notifies nobody', async () => {
      const task = await createTask(owner.token, mentionDoc(outsider.id));
      expect(delivered).toEqual([]);

      const res = await ctx.request(owner.token).get(`/api/tasks/${task.id}`);
      expect(res.status).toBe(200);
      const stored = (await res.json()) as TaskBody;
      expect(stored.description).toEqual(mentionDoc(outsider.id));
    });

    it('sends nothing when the task is deleted', async () => {
      const task = await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      const res = await ctx.request(owner.token).delete(`/api/tasks/${task.id}`);
      expect(res.status).toBe(204);
      expect(delivered).toEqual([]);
    });
  });

  describe('comment bodies', () => {
    it('resolves a mention in a new comment against the parent task', async () => {
      const task = await createTask(owner.token, null);
      const comment = await postComment(owner.token, task.id, mentionDoc(member.id));

      expect(delivered).toEqual([
        {
          actorUserId: owner.id,
          projectId,
          taskId: task.id,
          source: 'comment',
          recipientUserIds: [member.id],
        },
      ]);
      expect(comment.task_id).toBe(task.id);
    });

    it('accepts a comment whose whole body is a mention', async () => {
      const task = await createTask(owner.token, null);
      const body = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [mentionNode(member.id)] }],
      };
      const comment = await postComment(owner.token, task.id, body);

      expect(comment.body).toEqual(body);
      expect(delivered).toHaveLength(1);
    });

    it('resolves a mention an edit adds, and nothing on a re-save', async () => {
      const task = await createTask(owner.token, null);
      const comment = await postComment(member.token, task.id, textDoc('first pass'));
      delivered.length = 0;

      const patched = await ctx
        .request(member.token)
        .patch(`/api/comments/${comment.id}`, { body: mentionDoc(owner.id) });
      expect(patched.status).toBe(200);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({
        actorUserId: member.id,
        taskId: task.id,
        source: 'comment',
        recipientUserIds: [owner.id],
      });

      delivered.length = 0;
      const again = await ctx
        .request(member.token)
        .patch(`/api/comments/${comment.id}`, { body: mentionDoc(owner.id) });
      expect(again.status).toBe(200);
      expect(delivered).toEqual([]);
    });

    it('resolves an added mention once when two identical edits race', async () => {
      const task = await createTask(owner.token, null);
      const comment = await postComment(member.token, task.id, textDoc('first pass'));
      delivered.length = 0;

      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // Pinning the row until both patches are parked on it is what makes this
      // test fail if the pre-update read ever stops taking the lock.
      const holder = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('task_comment')
          .select('task_comment.id')
          .where('task_comment.id', '=', comment.id)
          .forUpdate()
          .execute();
        locked();
        await released;
      });
      await Promise.race([lockHeld, holder]);

      const patches = Promise.all([
        ctx
          .request(member.token)
          .patch(`/api/comments/${comment.id}`, { body: mentionDoc(owner.id) }),
        ctx
          .request(member.token)
          .patch(`/api/comments/${comment.id}`, { body: mentionDoc(owner.id) }),
      ]);
      try {
        await waitForLockWaiters(2);
      } finally {
        release();
      }
      await holder;
      const [a, b] = await patches;

      expect([a.status, b.status]).toEqual([200, 200]);
      expect(delivered).toHaveLength(1);
      expect(delivered[0].recipientUserIds).toEqual([owner.id]);
    });

    it('sends nothing when the comment is deleted', async () => {
      const task = await createTask(owner.token, null);
      const comment = await postComment(owner.token, task.id, mentionDoc(member.id));
      delivered.length = 0;

      const res = await ctx.request(owner.token).delete(`/api/comments/${comment.id}`);
      expect(res.status).toBe(204);
      expect(delivered).toEqual([]);
    });
  });

  describe('copies', () => {
    it('keeps the mention nodes and notifies nobody', async () => {
      await createTask(owner.token, mentionDoc(member.id));
      delivered.length = 0;

      const copyId = newId();
      projectIds.push(copyId);
      const res = await ctx
        .request(owner.token)
        .post('/api/projects', { id: copyId, name: 'Copy', source_project_id: projectId });
      expect(res.status).toBe(201);
      expect(delivered).toEqual([]);

      const copiedDescriptions = await db
        .selectFrom('task')
        .select('task.description')
        .where('task.project_id', '=', copyId)
        .execute();
      expect(
        copiedDescriptions.some(
          (row) => JSON.stringify(row.description).includes(`"${member.id}"`) === true
        )
      ).toBe(true);
    });
  });

  describe('rollback', () => {
    function buildApp(failAfterNotify: boolean): Hono<{ Variables: Required<Variables> }> {
      const app = new Hono<{ Variables: Required<Variables> }>();
      app.use('*', transactionMiddleware);
      app.onError(errorHandler);
      app.post('/notify', async (c) => {
        await notifyMentions(c, {
          actorUserId: owner.id,
          project: { id: projectId, created_by: owner.id },
          taskId: newId(),
          source: 'description',
          previous: null,
          next: mentionDoc(member.id),
        });
        if (failAfterNotify) {
          throw new Error('post-notify failure');
        }
        return c.body(null, 204);
      });
      return app;
    }

    it('delivers nothing when the transaction rolls back', async () => {
      const res = await buildApp(true).request('/notify', { method: 'POST' });
      expect(res.status).toBe(500);
      expect(delivered).toEqual([]);
    });

    it('delivers once when the same handler commits', async () => {
      const res = await buildApp(false).request('/notify', { method: 'POST' });
      expect(res.status).toBe(204);
      expect(delivered).toHaveLength(1);
    });
  });
});
