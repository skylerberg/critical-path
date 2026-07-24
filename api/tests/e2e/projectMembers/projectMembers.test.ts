import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects, insertTask } from '../projects/helpers';

describe('Project members API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('pm-owner');
    member = await ctx.createUser('pm-member');
    outsider = await ctx.createUser('pm-outsider');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProject(name = 'members project'): Promise<BoardPayloadBody> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  async function memberRows(projectId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('project_member')
      .select('user_id')
      .where('project_id', '=', projectId)
      .execute();
    return rows.map((row) => row.user_id);
  }

  describe('authentication', () => {
    it('rejects both endpoints without a token', async () => {
      const id = newId();
      const anon = ctx.request();
      const responses = await Promise.all([
        anon.put(`/api/projects/${id}/members`, { user_ids: [] }),
        anon.post(`/api/projects/${id}/members/by-email`, { email: 'a@b.com' }),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(401);
      }
    });
  });

  describe('PUT /api/projects/:id/members', () => {
    it('sets the member list, adding and removing as a diff', async () => {
      const board = await createProject('members diff');
      const projectId = board.project.id;

      const res = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [member.id, outsider.id],
      });
      expect(res.status).toBe(204);
      expect((await memberRows(projectId)).sort()).toEqual([member.id, outsider.id].sort());

      const removal = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [member.id],
      });
      expect(removal.status).toBe(204);
      expect(await memberRows(projectId)).toEqual([member.id]);
    });

    it('strips the creator id instead of storing a member row for them', async () => {
      const board = await createProject('creator strip');
      const projectId = board.project.id;

      const res = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [owner.id, member.id],
      });
      expect(res.status).toBe(204);
      expect(await memberRows(projectId)).toEqual([member.id]);

      const list = await ctx.request(owner.token).get('/api/projects');
      const item = (await list.json()).projects.find((p: { id: string }) => p.id === projectId);
      expect(item.member_ids).toEqual([member.id]);
    });

    it('accepts an empty set, reverting the project to personal', async () => {
      const board = await createProject('members empty');
      const projectId = board.project.id;
      await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });

      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [] });
      expect(res.status).toBe(204);
      expect(await memberRows(projectId)).toEqual([]);

      const denied = await ctx.request(member.token).get(`/api/projects/${projectId}`);
      expect(denied.status).toBe(404);
    });

    it('returns 422 for unknown user ids', async () => {
      const board = await createProject('members unknown');
      const res = await ctx.request(owner.token).put(`/api/projects/${board.project.id}/members`, {
        user_ids: [member.id, newId()],
      });
      expect(res.status).toBe(422);
    });

    it('returns 404 for non-accessors and unknown projects', async () => {
      const board = await createProject('members gated');
      const denied = await ctx
        .request(outsider.token)
        .put(`/api/projects/${board.project.id}/members`, { user_ids: [outsider.id] });
      expect(denied.status).toBe(404);
      expect(await memberRows(board.project.id)).toEqual([]);

      const missing = await ctx
        .request(owner.token)
        .put(`/api/projects/${newId()}/members`, { user_ids: [] });
      expect(missing.status).toBe(404);
    });

    it('lets a member manage the set and remove themselves to leave', async () => {
      const board = await createProject('open management');
      const projectId = board.project.id;
      await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });

      const invite = await ctx.request(member.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [member.id, outsider.id],
      });
      expect(invite.status).toBe(204);
      expect((await memberRows(projectId)).sort()).toEqual([member.id, outsider.id].sort());

      const leave = await ctx.request(member.token).put(`/api/projects/${projectId}/members`, {
        user_ids: [outsider.id],
      });
      expect(leave.status).toBe(204);
      expect(await memberRows(projectId)).toEqual([outsider.id]);

      const afterLeave = await ctx.request(member.token).get(`/api/projects/${projectId}`);
      expect(afterLeave.status).toBe(404);

      const cleanup = await ctx
        .request(outsider.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [] });
      expect(cleanup.status).toBe(204);
    });

    it('strips removed members’ assignments, keeping the creator’s', async () => {
      const board = await createProject('assignment strip');
      const projectId = board.project.id;
      await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });

      const taskId = await insertTask({ projectId, columnId: board.columns[0].id });
      await db
        .insertInto('task_assignee')
        .values([
          { task_id: taskId, user_id: owner.id },
          { task_id: taskId, user_id: member.id },
        ])
        .execute();

      const res = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [] });
      expect(res.status).toBe(204);

      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(assignees.map((row) => row.user_id)).toEqual([owner.id]);
    });
  });

  describe('POST /api/projects/:id/members/by-email', () => {
    it('adds a user by case-insensitive email and is idempotent', async () => {
      const board = await createProject('by email');
      const projectId = board.project.id;

      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${projectId}/members/by-email`, {
          email: member.email.toUpperCase(),
        });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        user: { id: member.id, email: member.email, name: member.name, avatar_url: null },
      });

      const again = await ctx
        .request(owner.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: member.email });
      expect(again.status).toBe(200);
      expect(await memberRows(projectId)).toEqual([member.id]);
    });

    it('treats the creator’s own email as a no-op without storing a row', async () => {
      const board = await createProject('by email creator');
      const projectId = board.project.id;

      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: owner.email });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { user: { id: string } }).user.id).toBe(owner.id);
      expect(await memberRows(projectId)).toEqual([]);
    });

    it('returns 404 for an unknown email', async () => {
      const board = await createProject('by email unknown');
      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, {
          email: `missing-${newId()}@test.example.com`,
        });
      expect(res.status).toBe(404);
    });

    it('returns 404 for non-accessors', async () => {
      const board = await createProject('by email gated');
      const res = await ctx
        .request(outsider.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, { email: member.email });
      expect(res.status).toBe(404);
    });
  });

  describe('membership-based access', () => {
    it('grants list/board access on add and revokes it on removal', async () => {
      const board = await createProject('access lifecycle');
      const projectId = board.project.id;

      const before = await ctx.request(member.token).get(`/api/projects/${projectId}`);
      expect(before.status).toBe(404);

      const add = await ctx
        .request(owner.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: member.email });
      expect(add.status).toBe(200);

      const after = await ctx.request(member.token).get(`/api/projects/${projectId}`);
      expect(after.status).toBe(200);
      expect(((await after.json()) as BoardPayloadBody).project).toMatchObject({
        id: projectId,
        created_by: owner.id,
        member_ids: [member.id],
      });

      const list = await ctx.request(member.token).get('/api/projects');
      expect((await list.json()).projects.some((p: { id: string }) => p.id === projectId)).toBe(
        true
      );

      const rename = await ctx
        .request(member.token)
        .patch(`/api/projects/${projectId}`, { name: 'renamed by member' });
      expect(rename.status).toBe(200);

      const remove = await ctx
        .request(owner.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [] });
      expect(remove.status).toBe(204);

      const revoked = await ctx.request(member.token).get(`/api/projects/${projectId}`);
      expect(revoked.status).toBe(404);
    });
  });

  describe('GET /api/workspaces (deprecated stub)', () => {
    it('requires auth and always returns an empty list', async () => {
      const anon = await ctx.request().get('/api/workspaces');
      expect(anon.status).toBe(401);

      const res = await ctx.request(owner.token).get('/api/workspaces');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ workspaces: [] });
    });
  });
});
