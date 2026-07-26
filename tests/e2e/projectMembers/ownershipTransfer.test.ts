import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects, insertTask } from '../projects/helpers';

describe('PUT /api/projects/:id/owner', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    owner = await ctx.createUser('transfer-owner');
    member = await ctx.createUser('transfer-member');
    outsider = await ctx.createUser('transfer-outsider');
  });

  afterAll(async () => {
    await deleteProjects(projectIds);
    await ctx.cleanup();
  });

  async function createProject(name = 'transfer project'): Promise<BoardPayloadBody> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  async function createSharedProject(name = 'transfer project'): Promise<string> {
    const board = await createProject(name);
    const res = await ctx
      .request(owner.token)
      .put(`/api/projects/${board.project.id}/members`, { user_ids: [member.id] });
    expect(res.status).toBe(204);
    return board.project.id;
  }

  async function memberRows(projectId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('project_member')
      .select('user_id')
      .where('project_id', '=', projectId)
      .execute();
    return rows.map((row) => row.user_id);
  }

  async function createdBy(projectId: string): Promise<string | undefined> {
    const row = await db
      .selectFrom('project')
      .select('created_by')
      .where('id', '=', projectId)
      .executeTakeFirst();
    return row?.created_by;
  }

  it('rejects the request without a token', async () => {
    const res = await ctx.request().put(`/api/projects/${newId()}/owner`, { user_id: newId() });
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown projects and for non-accessors', async () => {
    const missing = await ctx
      .request(owner.token)
      .put(`/api/projects/${newId()}/owner`, { user_id: member.id });
    expect(missing.status).toBe(404);

    const projectId = await createSharedProject('transfer gated');
    const denied = await ctx
      .request(outsider.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: outsider.id });
    expect(denied.status).toBe(404);
    expect(await createdBy(projectId)).toBe(owner.id);
  });

  it('returns 403 when a member who is not the creator calls it', async () => {
    const projectId = await createSharedProject('transfer by member');

    const res = await ctx
      .request(member.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: member.id });
    expect(res.status).toBe(403);
    expect(await createdBy(projectId)).toBe(owner.id);
    expect(await memberRows(projectId)).toEqual([member.id]);
  });

  it('returns 422 when user_id is not a member of the project', async () => {
    const projectId = await createSharedProject('transfer non member');

    const stranger = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: outsider.id });
    expect(stranger.status).toBe(422);

    const unknown = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: newId() });
    expect(unknown.status).toBe(422);

    expect(await createdBy(projectId)).toBe(owner.id);
    expect(await memberRows(projectId)).toEqual([member.id]);
  });

  it('returns 422 for a malformed body', async () => {
    const projectId = await createSharedProject('transfer bad body');

    const empty = await ctx.request(owner.token).put(`/api/projects/${projectId}/owner`, {});
    expect(empty.status).toBe(422);

    const notUuid = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: 'not-a-uuid' });
    expect(notUuid.status).toBe(422);
  });

  it('swaps creator and member representations on a successful transfer', async () => {
    const projectId = await createSharedProject('transfer happy path');

    const res = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: member.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: projectId,
      created_by: member.id,
      member_ids: [owner.id],
    });

    expect(await createdBy(projectId)).toBe(member.id);
    expect(await memberRows(projectId)).toEqual([owner.id]);
  });

  it('treats transferring to yourself as a no-op', async () => {
    const projectId = await createSharedProject('transfer to self');

    const res = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: owner.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      created_by: owner.id,
      member_ids: [member.id],
    });

    expect(await createdBy(projectId)).toBe(owner.id);
    expect(await memberRows(projectId)).toEqual([member.id]);
  });

  it('locks the previous owner out of transferring and lets the new owner transfer back', async () => {
    const projectId = await createSharedProject('transfer round trip');
    await ctx.request(owner.token).put(`/api/projects/${projectId}/owner`, { user_id: member.id });

    const again = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: owner.id });
    expect(again.status).toBe(403);

    const back = await ctx
      .request(member.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: owner.id });
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({
      created_by: owner.id,
      member_ids: [member.id],
    });
    expect(await createdBy(projectId)).toBe(owner.id);
    expect(await memberRows(projectId)).toEqual([member.id]);
  });

  it('lets the outgoing creator leave the project afterwards', async () => {
    const projectId = await createSharedProject('transfer then leave');
    await ctx.request(owner.token).put(`/api/projects/${projectId}/owner`, { user_id: member.id });

    const leave = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [] });
    expect(leave.status).toBe(204);

    expect((await ctx.request(owner.token).get(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await ctx.request(member.token).get(`/api/projects/${projectId}`)).status).toBe(200);
  });

  it('keeps both users’ task assignments through a transfer', async () => {
    const board = await createProject('transfer assignments');
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
      .put(`/api/projects/${projectId}/owner`, { user_id: member.id });
    expect(res.status).toBe(200);

    const assignees = await db
      .selectFrom('task_assignee')
      .select('user_id')
      .where('task_id', '=', taskId)
      .execute();
    expect(assignees.map((row) => row.user_id).sort()).toEqual([owner.id, member.id].sort());
  });

  it('refuses to delete an account that still owns a project, and allows it once ownership moves', async () => {
    const doomed = await ctx.createUser('transfer-doomed');
    const projectId = newId();
    projectIds.push(projectId);
    const created = await ctx
      .request(doomed.token)
      .post('/api/projects', { id: projectId, name: 'owned by doomed' });
    expect(created.status).toBe(201);
    await ctx
      .request(doomed.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });

    await expect(db.deleteFrom('app_user').where('id', '=', doomed.id).execute()).rejects.toThrow();

    const transfer = await ctx
      .request(doomed.token)
      .put(`/api/projects/${projectId}/owner`, { user_id: member.id });
    expect(transfer.status).toBe(200);
    await ctx.request(doomed.token).put(`/api/projects/${projectId}/members`, { user_ids: [] });

    await db.deleteFrom('app_user').where('id', '=', doomed.id).execute();
    const survivor = await db
      .selectFrom('project')
      .select('created_by')
      .where('id', '=', projectId)
      .executeTakeFirst();
    expect(survivor?.created_by).toBe(member.id);
  });
});
