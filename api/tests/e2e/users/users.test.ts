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
      email: alice.email,
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
    expect(body.users).toEqual([
      { id: stranger.id, email: stranger.email, name: stranger.name, avatar_url: null },
    ]);
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
  });
});
