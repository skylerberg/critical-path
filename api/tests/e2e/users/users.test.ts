import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

describe('GET /api/users', () => {
  const ctx = new TestContext();
  let alice: TestUser;
  let bob: TestUser;
  let stranger: TestUser;
  let workspaceId: string;
  const projectIds: string[] = [];

  beforeAll(async () => {
    alice = await ctx.createUser('aaa-users-alice');
    bob = await ctx.createUser('zzz-users-bob');
    stranger = await ctx.createUser('users-stranger');

    workspaceId = newId();
    await db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'users test ws', created_by: alice.id })
      .execute();
    await db
      .insertInto('workspace_member')
      .values([
        { workspace_id: workspaceId, user_id: alice.id },
        { workspace_id: workspaceId, user_id: bob.id },
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

  it('returns self plus workspace-sharing users ordered by name, never strangers', async () => {
    const res = await ctx.request(alice.token).get('/api/users');
    expect(res.status).toBe(200);

    const body = await res.json();
    const ids = body.users.map((u: { id: string }) => u.id);
    expect(ids).toContain(alice.id);
    expect(ids).toContain(bob.id);
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

  it('returns only self for a user with no workspaces', async () => {
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

    it('returns creator, workspace members, and still-assigned users', async () => {
      const projectId = newId();
      projectIds.push(projectId);
      await db
        .insertInto('project')
        .values({
          id: projectId,
          name: 'users scoped project',
          created_by: alice.id,
          workspace_id: workspaceId,
        })
        .execute();

      const columnId = newId();
      await db
        .insertInto('board_column')
        .values({ id: columnId, project_id: projectId, name: 'col', position: 1000 })
        .execute();
      const taskId = newId();
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
      await db
        .insertInto('task_assignee')
        .values({ task_id: taskId, user_id: stranger.id })
        .execute();

      const res = await ctx.request(bob.token).get(`/api/users?project_id=${projectId}`);
      expect(res.status).toBe(200);

      const body = await res.json();
      const ids = body.users.map((u: { id: string }) => u.id);
      expect(ids.sort()).toEqual([alice.id, bob.id, stranger.id].sort());
    });
  });
});
