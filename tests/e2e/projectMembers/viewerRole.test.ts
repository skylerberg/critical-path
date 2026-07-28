import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects, insertTask } from '../projects/helpers';

interface MemberEntry {
  user_id: string;
  role: string;
}

describe('Viewer role on the member endpoints', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let other: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('vr-owner');
    member = await ctx.createUser('vr-member');
    other = await ctx.createUser('vr-other');
    outsider = await ctx.createUser('vr-outsider');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProject(name: string): Promise<BoardPayloadBody> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  async function memberRows(projectId: string): Promise<MemberEntry[]> {
    const rows = await db
      .selectFrom('project_member')
      .select(['user_id', 'role'])
      .where('project_id', '=', projectId)
      .orderBy('created_at')
      .orderBy('user_id')
      .execute();
    return rows;
  }

  async function roleOf(projectId: string, userId: string): Promise<string | undefined> {
    return (await memberRows(projectId)).find((row) => row.user_id === userId)?.role;
  }

  async function setMembers(token: string, projectId: string, body: unknown): Promise<Response> {
    return await ctx.request(token).put(`/api/projects/${projectId}/members`, body);
  }

  async function createColumnFor(projectId: string): Promise<{ id: string }> {
    const id = newId();
    await db
      .insertInto('board_column')
      .values({ id, project_id: projectId, name: 'vr col', position: 1000 })
      .execute();
    return { id };
  }

  describe('setting roles', () => {
    it('sets a role alongside the member list', async () => {
      const { project } = await createProject('vr roles with list');
      const res = await setMembers(owner.token, project.id, {
        user_ids: [member.id],
        roles: [{ user_id: member.id, role: 'viewer' }],
      });
      expect(res.status).toBe(204);
      expect(await memberRows(project.id)).toEqual([{ user_id: member.id, role: 'viewer' }]);
    });

    it('changes a role with no user_ids, leaving the member set untouched', async () => {
      const { project } = await createProject('vr roles only');
      await setMembers(owner.token, project.id, { user_ids: [member.id, other.id] });

      const res = await setMembers(owner.token, project.id, {
        roles: [{ user_id: member.id, role: 'viewer' }],
      });
      expect(res.status).toBe(204);
      expect(await roleOf(project.id, member.id)).toBe('viewer');
      expect(await roleOf(project.id, other.id)).toBe('editor');
    });

    it('promotes a viewer back to editor', async () => {
      const { project } = await createProject('vr promote');
      await setMembers(owner.token, project.id, {
        user_ids: [member.id],
        roles: [{ user_id: member.id, role: 'viewer' }],
      });

      const res = await setMembers(owner.token, project.id, {
        roles: [{ user_id: member.id, role: 'editor' }],
      });
      expect(res.status).toBe(204);
      expect(await roleOf(project.id, member.id)).toBe('editor');
    });

    it('refuses a viewer body that carries roles rather than silently leaving instead', async () => {
      const { project } = await createProject('vr viewer roles body');
      await setMembers(owner.token, project.id, { user_ids: [member.id, other.id] });
      await setMembers(owner.token, project.id, {
        roles: [{ user_id: member.id, role: 'viewer' }],
      });

      const res = await setMembers(member.token, project.id, {
        user_ids: [other.id],
        roles: [{ user_id: other.id, role: 'viewer' }],
      });

      expect(res.status).toBe(403);
      expect(await roleOf(project.id, other.id)).toBe('editor');
      expect(await roleOf(project.id, member.id)).toBe('viewer');
    });

    // The interleave is forced with a real row lock rather than raced, so this fails
    // deterministically if the handler ever authorizes before taking the lock.
    it('refuses a by-email add from an editor demoted while the request was in flight', async () => {
      const { project } = await createProject('vr by-email demotion race');
      await setMembers(owner.token, project.id, { user_ids: [member.id] });
      expect(await roleOf(project.id, member.id)).toBe('editor');

      let releaseLock!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const demotion = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('project')
          .select('id')
          .where('id', '=', project.id)
          .forUpdate()
          .execute();
        await trx
          .updateTable('project_member')
          .set({ role: 'viewer' })
          .where('project_id', '=', project.id)
          .where('user_id', '=', member.id)
          .execute();
        await lockHeld;
      });

      const inFlight = ctx
        .request(member.token)
        .post(`/api/projects/${project.id}/members/by-email`, {
          email: member.email,
          role: 'editor',
        });
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseLock();
      await demotion;

      expect((await inFlight).status).toBe(403);
      expect(await roleOf(project.id, member.id)).toBe('viewer');
    });

    it('lets a role-only body keep a member added since the caller last synced', async () => {
      const { project } = await createProject('vr lost update');
      await setMembers(owner.token, project.id, { user_ids: [member.id] });
      const taskId = await insertTask({
        projectId: project.id,
        columnId: (await createColumnFor(project.id)).id,
      });

      await setMembers(owner.token, project.id, { user_ids: [member.id, other.id] });
      await db.insertInto('task_assignee').values({ task_id: taskId, user_id: other.id }).execute();

      const res = await setMembers(owner.token, project.id, {
        roles: [{ user_id: member.id, role: 'viewer' }],
      });
      expect(res.status).toBe(204);
      expect(await roleOf(project.id, other.id)).toBe('editor');

      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(assignees.map((row) => row.user_id)).toEqual([other.id]);
    });

    it('keeps a stored role when a later call sends user_ids and no roles', async () => {
      const { project } = await createProject('vr old client');
      await setMembers(owner.token, project.id, {
        user_ids: [member.id],
        roles: [{ user_id: member.id, role: 'viewer' }],
      });

      const res = await setMembers(owner.token, project.id, { user_ids: [member.id] });
      expect(res.status).toBe(204);
      expect(await roleOf(project.id, member.id)).toBe('viewer');
    });

    it('returns 422 for a roles entry naming someone outside the member set', async () => {
      const { project } = await createProject('vr roles outsider');
      await setMembers(owner.token, project.id, { user_ids: [member.id] });

      const res = await setMembers(owner.token, project.id, {
        roles: [{ user_id: other.id, role: 'viewer' }],
      });
      expect(res.status).toBe(422);
      expect(await memberRows(project.id)).toEqual([{ user_id: member.id, role: 'editor' }]);
    });

    it('silently strips the creator from roles rather than storing a row for them', async () => {
      const { project } = await createProject('vr roles creator');
      const res = await setMembers(owner.token, project.id, {
        user_ids: [member.id],
        roles: [{ user_id: owner.id, role: 'viewer' }],
      });
      expect(res.status).toBe(204);
      expect(await memberRows(project.id)).toEqual([{ user_id: member.id, role: 'editor' }]);
    });

    it('lets an editor member, not just the creator, change a role', async () => {
      const { project } = await createProject('vr editor member');
      await setMembers(owner.token, project.id, { user_ids: [member.id, other.id] });

      const res = await setMembers(member.token, project.id, {
        roles: [{ user_id: other.id, role: 'viewer' }],
      });
      expect(res.status).toBe(204);
      expect(await roleOf(project.id, other.id)).toBe('viewer');
    });

    it('adds a member directly as a viewer', async () => {
      const { project } = await createProject('vr add as viewer');
      const res = await setMembers(owner.token, project.id, {
        user_ids: [member.id],
        roles: [{ user_id: member.id, role: 'viewer' }],
      });
      expect(res.status).toBe(204);
      expect(await roleOf(project.id, member.id)).toBe('viewer');
    });
  });

  describe('a viewer calling the member endpoints', () => {
    async function projectWithViewer(name: string): Promise<string> {
      const { project } = await createProject(name);
      await setMembers(owner.token, project.id, {
        user_ids: [member.id, other.id],
        roles: [{ user_id: member.id, role: 'viewer' }],
      });
      return project.id;
    }

    it('refuses to add anyone', async () => {
      const projectId = await projectWithViewer('vr viewer adds');
      const res = await setMembers(member.token, projectId, {
        user_ids: [member.id, other.id, outsider.id],
      });
      expect(res.status).toBe(403);
      expect((await memberRows(projectId)).map((row) => row.user_id).sort()).toEqual(
        [member.id, other.id].sort()
      );
    });

    it('refuses a role change', async () => {
      const projectId = await projectWithViewer('vr viewer roles');
      const res = await setMembers(member.token, projectId, {
        roles: [{ user_id: member.id, role: 'editor' }],
      });
      expect(res.status).toBe(403);
      expect(await roleOf(projectId, member.id)).toBe('viewer');
    });

    it('reduces a stale self-removal to removing only themselves', async () => {
      const projectId = await projectWithViewer('vr viewer leaves');
      // The unknown id stands in for a member the viewer's cached list still
      // names; it must neither be resurrected nor answered with a 422.
      const res = await setMembers(member.token, projectId, { user_ids: [newId(), other.id] });
      expect(res.status).toBe(204);
      expect(await memberRows(projectId)).toEqual([{ user_id: other.id, role: 'editor' }]);

      const afterLeave = await ctx.request(member.token).get(`/api/projects/${projectId}`);
      expect(afterLeave.status).toBe(404);
    });

    it('never answers 422 on self-removal, so it is not a user-existence oracle', async () => {
      const projectId = await projectWithViewer('vr viewer oracle');
      const res = await setMembers(member.token, projectId, { user_ids: [newId()] });
      expect(res.status).toBe(204);

      const including = await projectWithViewer('vr viewer oracle 2');
      const denied = await setMembers(member.token, including, {
        user_ids: [member.id, newId()],
      });
      expect(denied.status).toBe(403);
    });

    it('strips their own assignments when they leave', async () => {
      const projectId = await projectWithViewer('vr viewer assignments');
      const taskId = await insertTask({
        projectId,
        columnId: (await createColumnFor(projectId)).id,
      });
      await db
        .insertInto('task_assignee')
        .values({ task_id: taskId, user_id: member.id })
        .execute();

      const res = await setMembers(member.token, projectId, { user_ids: [other.id] });
      expect(res.status).toBe(204);
      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(assignees).toEqual([]);
    });

    it('is refused by-email', async () => {
      const projectId = await projectWithViewer('vr viewer by email');
      const res = await ctx
        .request(member.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: outsider.email });
      expect(res.status).toBe(403);
      expect((await memberRows(projectId)).map((row) => row.user_id).sort()).toEqual(
        [member.id, other.id].sort()
      );
    });

    it('still gets 404, not 403, for an outsider on both endpoints', async () => {
      const projectId = await projectWithViewer('vr outsider gated');
      expect((await setMembers(outsider.token, projectId, { user_ids: [] })).status).toBe(404);
      const byEmail = await ctx
        .request(outsider.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: member.email });
      expect(byEmail.status).toBe(404);
    });
  });

  describe('POST /api/projects/:id/members/by-email with a role', () => {
    it('adds a viewer and reports the role', async () => {
      const { project } = await createProject('vr by-email viewer');
      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${project.id}/members/by-email`, {
          email: member.email,
          role: 'viewer',
        });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        user: { id: member.id, email: member.email, name: member.name, avatar_url: null },
        role: 'viewer',
      });
      expect(await roleOf(project.id, member.id)).toBe('viewer');
    });

    it('does not promote an existing viewer when role is omitted', async () => {
      const { project } = await createProject('vr by-email no promote');
      await ctx.request(owner.token).post(`/api/projects/${project.id}/members/by-email`, {
        email: member.email,
        role: 'viewer',
      });

      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${project.id}/members/by-email`, { email: member.email });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ role: 'viewer' });
      expect(await roleOf(project.id, member.id)).toBe('viewer');
    });

    it('promotes an existing viewer when role says editor', async () => {
      const { project } = await createProject('vr by-email promote');
      await ctx.request(owner.token).post(`/api/projects/${project.id}/members/by-email`, {
        email: member.email,
        role: 'viewer',
      });

      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${project.id}/members/by-email`, {
          email: member.email,
          role: 'editor',
        });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ role: 'editor' });
      expect(await roleOf(project.id, member.id)).toBe('editor');
    });

    it('reports the creator as an editor without storing a row', async () => {
      const { project } = await createProject('vr by-email creator');
      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${project.id}/members/by-email`, {
          email: owner.email,
          role: 'viewer',
        });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ role: 'editor' });
      expect(await memberRows(project.id)).toEqual([]);
    });
  });

  describe('roles in the read payloads', () => {
    it('carries members and member_ids in the same order on both project reads', async () => {
      const { project } = await createProject('vr payload');
      await setMembers(owner.token, project.id, {
        user_ids: [member.id, other.id],
        roles: [{ user_id: other.id, role: 'viewer' }],
      });

      const expectedRoles = new Map([
        [member.id, 'editor'],
        [other.id, 'viewer'],
      ]);

      function assertMembers(payload: { member_ids: string[]; members: MemberEntry[] }): void {
        expect(payload.members.map((entry) => entry.user_id)).toEqual(payload.member_ids);
        expect(new Map(payload.members.map((entry) => [entry.user_id, entry.role]))).toEqual(
          expectedRoles
        );
      }

      const board = await ctx.request(owner.token).get(`/api/projects/${project.id}`);
      expect(board.status).toBe(200);
      assertMembers(((await board.json()) as BoardPayloadBody).project);

      const list = await ctx.request(owner.token).get('/api/projects');
      const item = (
        (await list.json()) as {
          projects: { id: string; member_ids: string[]; members: MemberEntry[] }[];
        }
      ).projects.find((p) => p.id === project.id);
      expect(item).toBeDefined();
      assertMembers(item as { member_ids: string[]; members: MemberEntry[] });
    });

    it('reports an empty members array on a personal project', async () => {
      const { project } = await createProject('vr payload personal');
      expect(project).toMatchObject({ members: [], member_ids: [] });
    });
  });
});
