import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';

interface WorkspaceBody {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  member_ids: string[];
}

describe('Workspaces API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('ws-owner');
    member = await ctx.createUser('ws-member');
    outsider = await ctx.createUser('ws-outsider');
  });

  afterAll(async () => {
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  async function createWorkspace(name = 'test workspace'): Promise<string> {
    const id = newId();
    const res = await ctx.request(owner.token).post('/api/workspaces', { id, name });
    expect(res.status).toBe(201);
    return id;
  }

  async function addMember(workspaceId: string, userId: string): Promise<void> {
    await db
      .insertInto('workspace_member')
      .values({ workspace_id: workspaceId, user_id: userId })
      .execute();
  }

  describe('authentication', () => {
    it('rejects every endpoint without a token', async () => {
      const id = newId();
      const anon = ctx.request();
      const responses = await Promise.all([
        anon.get('/api/workspaces'),
        anon.post('/api/workspaces', { id, name: 'Nope' }),
        anon.patch(`/api/workspaces/${id}`, { name: 'Nope' }),
        anon.delete(`/api/workspaces/${id}`),
        anon.put(`/api/workspaces/${id}/members`, { user_ids: [id] }),
        anon.post(`/api/workspaces/${id}/members/by-email`, { email: 'a@b.com' }),
      ]);
      for (const res of responses) {
        expect(res.status).toBe(401);
      }
    });
  });

  describe('POST /api/workspaces', () => {
    it('creates a workspace with the creator as its first member', async () => {
      const id = newId();
      const res = await ctx.request(owner.token).post('/api/workspaces', { id, name: 'Studio' });
      expect(res.status).toBe(201);

      const body = (await res.json()) as WorkspaceBody;
      expect(body).toMatchObject({
        id,
        name: 'Studio',
        created_by: owner.id,
        member_ids: [owner.id],
      });
      expect(typeof body.created_at).toBe('string');
    });

    it('returns 409 for a duplicate id', async () => {
      const id = await createWorkspace('dup ws');
      const res = await ctx.request(owner.token).post('/api/workspaces', { id, name: 'Again' });
      expect(res.status).toBe(409);
    });

    it('returns 422 for an empty name', async () => {
      const res = await ctx
        .request(owner.token)
        .post('/api/workspaces', { id: newId(), name: '   ' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    });
  });

  describe('GET /api/workspaces', () => {
    it('lists only workspaces the caller belongs to, with member ids', async () => {
      const wsId = await createWorkspace('mine');
      await addMember(wsId, member.id);

      const ownRes = await ctx.request(owner.token).get('/api/workspaces');
      expect(ownRes.status).toBe(200);
      const ownBody = (await ownRes.json()) as { workspaces: WorkspaceBody[] };
      const mine = ownBody.workspaces.find((w) => w.id === wsId);
      expect(mine).toBeDefined();
      expect(mine!.member_ids.sort()).toEqual([owner.id, member.id].sort());

      const outsiderRes = await ctx.request(outsider.token).get('/api/workspaces');
      const outsiderBody = (await outsiderRes.json()) as { workspaces: WorkspaceBody[] };
      expect(outsiderBody.workspaces.find((w) => w.id === wsId)).toBeUndefined();
    });
  });

  describe('PATCH /api/workspaces/:id', () => {
    it('renames for any member and returns the row unchanged for an empty patch', async () => {
      const wsId = await createWorkspace('before rename');
      await addMember(wsId, member.id);

      const res = await ctx
        .request(member.token)
        .patch(`/api/workspaces/${wsId}`, { name: 'after rename' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as WorkspaceBody).name).toBe('after rename');

      const empty = await ctx.request(owner.token).patch(`/api/workspaces/${wsId}`, {});
      expect(empty.status).toBe(200);
      expect(((await empty.json()) as WorkspaceBody).name).toBe('after rename');
    });

    it('returns 404 for non-members and unknown workspaces', async () => {
      const wsId = await createWorkspace('rename gated');
      const denied = await ctx
        .request(outsider.token)
        .patch(`/api/workspaces/${wsId}`, { name: 'nope' });
      expect(denied.status).toBe(404);

      const missing = await ctx
        .request(owner.token)
        .patch(`/api/workspaces/${newId()}`, { name: 'nope' });
      expect(missing.status).toBe(404);
    });
  });

  describe('DELETE /api/workspaces/:id', () => {
    it('deletes the workspace and reverts its projects to personal', async () => {
      const wsId = await createWorkspace('doomed ws');
      const projectId = newId();
      projectIds.push(projectId);
      await db
        .insertInto('project')
        .values({ id: projectId, name: 'ws project', created_by: owner.id, workspace_id: wsId })
        .execute();

      const res = await ctx.request(owner.token).delete(`/api/workspaces/${wsId}`);
      expect(res.status).toBe(204);

      const workspace = await db
        .selectFrom('workspace')
        .select('id')
        .where('id', '=', wsId)
        .executeTakeFirst();
      expect(workspace).toBeUndefined();

      const project = await db
        .selectFrom('project')
        .select(['id', 'workspace_id'])
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      expect(project.workspace_id).toBeNull();
    });

    it('returns 404 for non-members', async () => {
      const wsId = await createWorkspace('delete gated');
      const res = await ctx.request(outsider.token).delete(`/api/workspaces/${wsId}`);
      expect(res.status).toBe(404);

      const still = await db
        .selectFrom('workspace')
        .select('id')
        .where('id', '=', wsId)
        .executeTakeFirst();
      expect(still?.id).toBe(wsId);
    });
  });

  describe('PUT /api/workspaces/:id/members', () => {
    it('sets the member list, adding and removing as a diff', async () => {
      const wsId = await createWorkspace('members set');

      const res = await ctx.request(owner.token).put(`/api/workspaces/${wsId}/members`, {
        user_ids: [owner.id, member.id],
      });
      expect(res.status).toBe(204);

      const rows = await db
        .selectFrom('workspace_member')
        .select('user_id')
        .where('workspace_id', '=', wsId)
        .execute();
      expect(rows.map((r) => r.user_id).sort()).toEqual([owner.id, member.id].sort());

      const removal = await ctx.request(owner.token).put(`/api/workspaces/${wsId}/members`, {
        user_ids: [owner.id],
      });
      expect(removal.status).toBe(204);

      const after = await db
        .selectFrom('workspace_member')
        .select('user_id')
        .where('workspace_id', '=', wsId)
        .execute();
      expect(after.map((r) => r.user_id)).toEqual([owner.id]);
    });

    it('returns 422 when the caller is not in the set', async () => {
      const wsId = await createWorkspace('must include caller');
      const res = await ctx.request(owner.token).put(`/api/workspaces/${wsId}/members`, {
        user_ids: [member.id],
      });
      expect(res.status).toBe(422);
    });

    it('returns 422 for unknown user ids', async () => {
      const wsId = await createWorkspace('unknown members');
      const res = await ctx.request(owner.token).put(`/api/workspaces/${wsId}/members`, {
        user_ids: [owner.id, newId()],
      });
      expect(res.status).toBe(422);
    });

    it('returns 404 for non-members', async () => {
      const wsId = await createWorkspace('members gated');
      const res = await ctx.request(outsider.token).put(`/api/workspaces/${wsId}/members`, {
        user_ids: [outsider.id],
      });
      expect(res.status).toBe(404);
    });

    it('strips removed members’ assignments across the workspace’s projects, keeping creators', async () => {
      const wsId = await createWorkspace('assignment strip');
      await addMember(wsId, member.id);

      const projectId = newId();
      projectIds.push(projectId);
      await db
        .insertInto('project')
        .values({ id: projectId, name: 'strip project', created_by: owner.id, workspace_id: wsId })
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
        .values([
          { task_id: taskId, user_id: owner.id },
          { task_id: taskId, user_id: member.id },
        ])
        .execute();

      const res = await ctx.request(owner.token).put(`/api/workspaces/${wsId}/members`, {
        user_ids: [owner.id],
      });
      expect(res.status).toBe(204);

      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(assignees.map((r) => r.user_id)).toEqual([owner.id]);
    });
  });

  describe('POST /api/workspaces/:id/members/by-email', () => {
    it('adds a user by case-insensitive email and is idempotent', async () => {
      const wsId = await createWorkspace('by email');

      const res = await ctx.request(owner.token).post(`/api/workspaces/${wsId}/members/by-email`, {
        email: member.email.toUpperCase(),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        user: { id: member.id, email: member.email, name: member.name, avatar_url: null },
      });

      const again = await ctx
        .request(owner.token)
        .post(`/api/workspaces/${wsId}/members/by-email`, { email: member.email });
      expect(again.status).toBe(200);

      const rows = await db
        .selectFrom('workspace_member')
        .select('user_id')
        .where('workspace_id', '=', wsId)
        .where('user_id', '=', member.id)
        .execute();
      expect(rows).toHaveLength(1);
    });

    it('returns 404 for an unknown email', async () => {
      const wsId = await createWorkspace('by email unknown');
      const res = await ctx.request(owner.token).post(`/api/workspaces/${wsId}/members/by-email`, {
        email: `missing-${newId()}@test.example.com`,
      });
      expect(res.status).toBe(404);
    });

    it('returns 404 for non-members', async () => {
      const wsId = await createWorkspace('by email gated');
      const res = await ctx
        .request(outsider.token)
        .post(`/api/workspaces/${wsId}/members/by-email`, { email: member.email });
      expect(res.status).toBe(404);
    });
  });
});
