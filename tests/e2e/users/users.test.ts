import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

describe('GET /api/users', () => {
  const ctx = new TestContext();
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let stranger: TestUser;
  let sharedProjectId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    alice = await ctx.createUser('aaa-users-alice');
    bob = await ctx.createUser('zzz-users-bob');
    carol = await ctx.createUser('mmm-users-carol');
    stranger = await ctx.createUser('users-stranger');

    sharedProjectId = newId();
    projectIds.push(sharedProjectId);
    await db
      .insertInto('project')
      .values({ id: sharedProjectId, name: 'users shared project', created_by: alice.id })
      .execute();
    await db
      .insertInto('project_member')
      .values([
        { project_id: sharedProjectId, user_id: bob.id },
        { project_id: sharedProjectId, user_id: carol.id },
      ])
      .execute();
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  it('requires auth', async () => {
    const res = await ctx.request().get('/api/users');
    expect(res.status).toBe(401);
  });

  it('returns self plus project-sharing users ordered by name, never strangers', async () => {
    const res = await ctx.request(alice.token).get('/api/users');
    expect(res.status).toBe(200);

    const body = await res.json();
    const ids = body.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(alice.id);
    expect(ids).toContain(bob.id);
    expect(ids).toContain(carol.id);
    expect(ids).not.toContain(stranger.id);
    expect(ids.indexOf(alice.id)).toBeLessThan(ids.indexOf(bob.id));

    const aliceRow = body.users.find((u: { id: string }) => u.id === alice.id);
    expect(aliceRow).toEqual({
      id: alice.id,
      name: alice.name,
      avatar_url: null,
    });
  });

  it('lets members see the creator and their co-members', async () => {
    const res = await ctx.request(bob.token).get('/api/users');
    expect(res.status).toBe(200);

    const ids = (await res.json()).users.map((u: { id: string }) => u.id);
    expect(ids.sort()).toEqual([alice.id, bob.id, carol.id].sort());
  });

  it('returns only self for a user sharing no projects', async () => {
    const res = await ctx.request(stranger.token).get('/api/users');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.users).toEqual([{ id: stranger.id, name: stranger.name, avatar_url: null }]);
  });

  it('never carries an email address, in either mode', async () => {
    const responses = [
      await ctx.request(alice.token).get('/api/users'),
      await ctx.request(alice.token).get(`/api/users?project_id=${sharedProjectId}`),
    ];

    for (const res of responses) {
      expect(res.status).toBe(200);
      const body = await res.json();
      const ids = body.users.map((u: { id: string }) => u.id);
      // Asserted before the absence, so an empty payload cannot pass this.
      expect(ids).toEqual(expect.arrayContaining([alice.id, bob.id, carol.id]));
      for (const user of body.users) {
        expect(Object.keys(user).sort()).toEqual(['avatar_url', 'id', 'name']);
      }
      const serialized = JSON.stringify(body);
      for (const address of [alice.email, bob.email, carol.email]) {
        expect(serialized).not.toContain(address);
      }
    }
  });

  describe('?email=', () => {
    it('names a visible user by their exact address, case-insensitively', async () => {
      for (const address of [bob.email, bob.email.toUpperCase()]) {
        const res = await ctx
          .request(alice.token)
          .get(`/api/users?email=${encodeURIComponent(address)}`);
        expect(res.status).toBe(200);
        expect((await res.json()).users).toEqual([
          { id: bob.id, name: bob.name, avatar_url: null },
        ]);
      }
    });

    it('names a user within a project the caller can read', async () => {
      const res = await ctx
        .request(bob.token)
        .get(`/api/users?project_id=${sharedProjectId}&email=${encodeURIComponent(carol.email)}`);
      expect(res.status).toBe(200);
      expect((await res.json()).users).toEqual([
        { id: carol.id, name: carol.name, avatar_url: null },
      ]);
    });

    it('answers an empty list, not 404, for an address outside the caller’s reach', async () => {
      for (const address of [stranger.email, `nobody-${newId()}@test.example.com`]) {
        const res = await ctx
          .request(bob.token)
          .get(`/api/users?email=${encodeURIComponent(address)}`);
        expect(res.status).toBe(200);
        expect((await res.json()).users).toEqual([]);
      }
    });

    it('keeps 404 meaning the project, not the address', async () => {
      const denied = await ctx
        .request(stranger.token)
        .get(`/api/users?project_id=${sharedProjectId}&email=${encodeURIComponent(bob.email)}`);
      expect(denied.status).toBe(404);

      const readable = await ctx
        .request(alice.token)
        .get(
          `/api/users?project_id=${sharedProjectId}&email=${encodeURIComponent(stranger.email)}`
        );
      expect(readable.status).toBe(200);
      expect((await readable.json()).users).toEqual([]);
    });

    it('rejects a malformed address', async () => {
      const res = await ctx.request(alice.token).get('/api/users?email=not-an-address');
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
    });

    it('returns no address anywhere in a filtered response', async () => {
      const responses = [
        await ctx.request(alice.token).get(`/api/users?email=${encodeURIComponent(bob.email)}`),
        await ctx
          .request(alice.token)
          .get(`/api/users?project_id=${sharedProjectId}&email=${encodeURIComponent(bob.email)}`),
      ];

      for (const res of responses) {
        expect(res.status).toBe(200);
        const body = await res.json();
        // Asserted before the absence, so an empty payload cannot pass this.
        expect(body.users.map((u: { id: string }) => u.id)).toEqual([bob.id]);
        expect(Object.keys(body.users[0]).sort()).toEqual(['avatar_url', 'id', 'name']);
        const serialized = JSON.stringify(body);
        for (const address of [bob.email, bob.email.toLowerCase(), bob.email.split('@')[0]]) {
          expect(serialized).not.toContain(address);
        }
      }
    });
  });

  describe('?project_id=', () => {
    it('returns 400 for a malformed project_id', async () => {
      const res = await ctx.request(alice.token).get('/api/users?project_id=not-a-uuid');
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
    });

    it('returns 404 for a project the caller cannot access', async () => {
      const projectId = newId();
      projectIds.push(projectId);
      await db
        .insertInto('project')
        .values({ id: projectId, name: 'alice personal', created_by: alice.id })
        .execute();

      const denied = await ctx.request(stranger.token).get(`/api/users?project_id=${projectId}`);
      expect(denied.status).toBe(404);

      const missing = await ctx.request(alice.token).get(`/api/users?project_id=${newId()}`);
      expect(missing.status).toBe(404);
    });

    it('returns creator, members, and still-assigned users', async () => {
      const columnId = newId();
      await db
        .insertInto('board_column')
        .values({ id: columnId, project_id: sharedProjectId, name: 'col', position: 1000 })
        .execute();
      const taskId = newId();
      await db
        .insertInto('task')
        .values({
          id: taskId,
          project_id: sharedProjectId,
          column_id: columnId,
          title: 't',
          position: 1000,
        })
        .execute();
      await db
        .insertInto('task_assignee')
        .values({ task_id: taskId, user_id: stranger.id })
        .execute();

      const res = await ctx.request(bob.token).get(`/api/users?project_id=${sharedProjectId}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      const ids = body.users.map((u: { id: string }) => u.id);
      expect(ids.sort()).toEqual([alice.id, bob.id, carol.id, stranger.id].sort());
    });

    it('keeps a non-member comment author listed until their comment is gone', async () => {
      const outsider = await ctx.createUser('users-commenter');
      const columnId = newId();
      await db
        .insertInto('board_column')
        .values({ id: columnId, project_id: sharedProjectId, name: 'comment col', position: 2000 })
        .execute();
      const taskId = newId();
      await db
        .insertInto('task')
        .values({
          id: taskId,
          project_id: sharedProjectId,
          column_id: columnId,
          title: 'commented',
          position: 1000,
        })
        .execute();
      const commentId = newId();
      await db
        .insertInto('task_comment')
        .values({
          id: commentId,
          task_id: taskId,
          user_id: outsider.id,
          body: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'drive-by' }] }],
          }),
        })
        .execute();

      const withComment = await ctx
        .request(bob.token)
        .get(`/api/users?project_id=${sharedProjectId}`);
      expect(withComment.status).toBe(200);
      const listed = (await withComment.json()).users.map((u: { id: string }) => u.id);
      expect(listed).toContain(outsider.id);

      await db.deleteFrom('task_comment').where('id', '=', commentId).execute();

      const withoutComment = await ctx
        .request(bob.token)
        .get(`/api/users?project_id=${sharedProjectId}`);
      const remaining = (await withoutComment.json()).users.map((u: { id: string }) => u.id);
      expect(remaining).not.toContain(outsider.id);
    });
  });
});
