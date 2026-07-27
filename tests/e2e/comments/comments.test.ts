import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

interface CommentBody {
  id: string;
  task_id: string;
  user_id: string;
  body: unknown;
  created_at: string;
  updated_at: string;
}

function docWith(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const WHITESPACE_DOC = docWith('   ');
const SCRIPT_LINK_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:1' } }] },
      ],
    },
  ],
};

describe('Comments API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  async function createTaskFixture(): Promise<{ projectId: string; taskId: string }> {
    const projectId = newId();
    const columnId = newId();
    const taskId = newId();
    await db
      .insertInto('project')
      .values({ id: projectId, name: 'comments project', created_by: owner.id })
      .execute();
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: member.id })
      .execute();
    await db
      .insertInto('board_column')
      .values({ id: columnId, project_id: projectId, name: 'To Do', position: 1000 })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: projectId,
        column_id: columnId,
        title: 't',
        position: 1000,
      })
      .execute();
    projectIds.push(projectId);
    return { projectId, taskId };
  }

  async function postComment(
    token: string,
    taskId: string,
    text: string,
    id = newId()
  ): Promise<CommentBody> {
    const res = await ctx.request(token).post('/api/comments', {
      id,
      task_id: taskId,
      body: docWith(text),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as CommentBody;
  }

  beforeAll(async () => {
    owner = await ctx.createUser('comments-owner');
    member = await ctx.createUser('comments-member');
    outsider = await ctx.createUser('comments-outsider');
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  describe('POST /api/comments', () => {
    it('requires auth', async () => {
      const { taskId } = await createTaskFixture();
      const res = await ctx
        .request()
        .post('/api/comments', { id: newId(), task_id: taskId, body: docWith('hi') });
      expect(res.status).toBe(401);
    });

    it('creates a comment with the client-supplied id and equal timestamps', async () => {
      const { taskId } = await createTaskFixture();
      const id = newId();
      const res = await ctx
        .request(owner.token)
        .post('/api/comments', { id, task_id: taskId, body: docWith('first') });
      expect(res.status).toBe(201);
      const comment = (await res.json()) as CommentBody;
      expect(comment).toMatchObject({
        id,
        task_id: taskId,
        user_id: owner.id,
        body: docWith('first'),
      });
      expect(typeof comment.created_at).toBe('string');
      expect(comment.updated_at).toBe(comment.created_at);
    });

    it('returns 409 for a duplicate id', async () => {
      const { taskId } = await createTaskFixture();
      const id = newId();
      await postComment(owner.token, taskId, 'first', id);
      const again = await ctx
        .request(owner.token)
        .post('/api/comments', { id, task_id: taskId, body: docWith('again') });
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: 'Comment id already in use' });
    });

    it('rejects an empty or whitespace-only body with 422', async () => {
      const { taskId } = await createTaskFixture();
      for (const body of [EMPTY_DOC, WHITESPACE_DOC]) {
        const res = await ctx
          .request(owner.token)
          .post('/api/comments', { id: newId(), task_id: taskId, body });
        expect(res.status).toBe(422);
      }
    });

    it('applies the shared Tiptap allow-list to comment bodies', async () => {
      const { taskId } = await createTaskFixture();
      const res = await ctx
        .request(owner.token)
        .post('/api/comments', { id: newId(), task_id: taskId, body: SCRIPT_LINK_DOC });
      expect(res.status).toBe(422);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx
        .request(owner.token)
        .post('/api/comments', { id: newId(), task_id: newId(), body: docWith('hi') });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Task not found' });
    });

    it('returns 404, never 403, for a task in an inaccessible project', async () => {
      const { taskId } = await createTaskFixture();
      const res = await ctx
        .request(outsider.token)
        .post('/api/comments', { id: newId(), task_id: taskId, body: docWith('hi') });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Task not found' });
    });

    it('lets a project member who is not the creator comment', async () => {
      const { taskId } = await createTaskFixture();
      const comment = await postComment(member.token, taskId, 'from a member');
      expect(comment.user_id).toBe(member.id);
    });
  });

  describe('PATCH /api/comments/:id', () => {
    it('replaces the body and advances only updated_at', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'before');

      const res = await ctx
        .request(owner.token)
        .patch(`/api/comments/${created.id}`, { body: docWith('after') });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as CommentBody;
      expect(updated.body).toEqual(docWith('after'));
      expect(updated.created_at).toBe(created.created_at);
      expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(created.updated_at));
    });

    it('rejects an empty body with 422', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'keep me');
      const res = await ctx
        .request(owner.token)
        .patch(`/api/comments/${created.id}`, { body: EMPTY_DOC });
      expect(res.status).toBe(422);
    });

    it('returns 404 for another member and leaves the row intact', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'mine');

      const res = await ctx
        .request(member.token)
        .patch(`/api/comments/${created.id}`, { body: docWith('hijacked') });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Comment not found' });

      const row = await db
        .selectFrom('task_comment')
        .select('body')
        .where('id', '=', created.id)
        .executeTakeFirstOrThrow();
      expect(row.body).toEqual(docWith('mine'));
    });

    it('returns 404 for a user with no project access', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'mine');
      const res = await ctx
        .request(outsider.token)
        .patch(`/api/comments/${created.id}`, { body: docWith('nope') });
      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed id', async () => {
      const res = await ctx
        .request(owner.token)
        .patch('/api/comments/not-a-uuid', { body: docWith('x') });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/comments/:id', () => {
    it('deletes the caller’s own comment and 404s on a second delete', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'bye');

      const res = await ctx.request(owner.token).delete(`/api/comments/${created.id}`);
      expect(res.status).toBe(204);
      const again = await ctx.request(owner.token).delete(`/api/comments/${created.id}`);
      expect(again.status).toBe(404);
    });

    it('returns 404 for another member and leaves the row intact', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'mine');

      const res = await ctx.request(member.token).delete(`/api/comments/${created.id}`);
      expect(res.status).toBe(404);

      const row = await db
        .selectFrom('task_comment')
        .select('id')
        .where('id', '=', created.id)
        .executeTakeFirst();
      expect(row).toBeDefined();
    });

    it('returns 404 for a user with no project access', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'mine');
      const res = await ctx.request(outsider.token).delete(`/api/comments/${created.id}`);
      expect(res.status).toBe(404);
    });
  });

  describe('task detail and board payload', () => {
    it('returns comments oldest first with a matching comment_count', async () => {
      const { projectId, taskId } = await createTaskFixture();
      const first = await postComment(owner.token, taskId, 'one');
      const second = await postComment(member.token, taskId, 'two');
      const third = await postComment(owner.token, taskId, 'three');

      const res = await ctx.request(owner.token).get(`/api/tasks/${taskId}`);
      expect(res.status).toBe(200);
      const detail = await res.json();
      expect(detail.comments.map((c: CommentBody) => c.id)).toEqual([
        first.id,
        second.id,
        third.id,
      ]);
      expect(detail.comments[1]).toMatchObject({
        task_id: taskId,
        user_id: member.id,
        body: docWith('two'),
      });
      expect(detail.comment_count).toBe(detail.comments.length);

      const board = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
      const payload = await board.json();
      expect(payload.tasks.find((t: { id: string }) => t.id === taskId).comment_count).toBe(3);
    });

    it('leaves comment_count correct after an unrelated task patch', async () => {
      const { taskId } = await createTaskFixture();
      await postComment(owner.token, taskId, 'one');
      await postComment(owner.token, taskId, 'two');

      const res = await ctx
        .request(owner.token)
        .patch(`/api/tasks/${taskId}`, { title: 'renamed' });
      expect(res.status).toBe(200);
      expect((await res.json()).comment_count).toBe(2);
    });
  });

  describe('cascades', () => {
    it('removes comments when the task is deleted', async () => {
      const { taskId } = await createTaskFixture();
      const created = await postComment(owner.token, taskId, 'doomed');

      expect((await ctx.request(owner.token).delete(`/api/tasks/${taskId}`)).status).toBe(204);
      const row = await db
        .selectFrom('task_comment')
        .select('id')
        .where('id', '=', created.id)
        .executeTakeFirst();
      expect(row).toBeUndefined();
    });

    it('removes comments when their author’s account is deleted', async () => {
      const { taskId } = await createTaskFixture();
      const author = await ctx.createUser('comments-leaver');
      await db
        .insertInto('project_member')
        .values({ project_id: projectIds[projectIds.length - 1], user_id: author.id })
        .execute();
      const created = await postComment(author.token, taskId, 'from the leaver');

      await db.deleteFrom('app_user').where('id', '=', author.id).execute();

      const row = await db
        .selectFrom('task_comment')
        .select('id')
        .where('id', '=', created.id)
        .executeTakeFirst();
      expect(row).toBeUndefined();
    });
  });
});
