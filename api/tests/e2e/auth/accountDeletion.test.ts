import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { env } from '../../../src/config/env';
import { subscribeBus, SESSIONS_REVOKED, type BusEntry } from '../../../src/services/realtime/bus';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function imageForm(): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(PNG_1X1)], 'shot.png', { type: 'image/png' }));
  return form;
}

async function collectBusEntries(run: () => Promise<void>): Promise<BusEntry[]> {
  const seen: BusEntry[] = [];
  const unsubscribe = subscribeBus((entry) => seen.push(entry));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return seen;
}

describe('DELETE /api/auth/me', () => {
  const ctx = new TestContext();
  const uploadedKeys: string[] = [];
  const strayProjectIds: string[] = [];

  function storagePath(key: string): string {
    uploadedKeys.push(key);
    return path.join(env.storageDiskRoot, key);
  }

  const firstColumnIds = new Map<string, string>();

  async function createProject(user: TestUser, name: string): Promise<string> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    strayProjectIds.push(id);
    firstColumnIds.set(id, (await res.json()).columns[0].id);
    return id;
  }

  async function createTask(user: TestUser, projectId: string, title: string): Promise<string> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: firstColumnIds.get(projectId),
      title,
      position: 1000,
    });
    expect(res.status).toBe(201);
    return id;
  }

  async function uploadTaskImage(user: TestUser, taskId: string): Promise<string> {
    const res = await ctx
      .request(user.token)
      .postMultipart(`/api/tasks/${taskId}/images`, imageForm());
    expect(res.status).toBe(201);
    const imageId = (await res.json()).id;
    const row = await db
      .selectFrom('task_image')
      .select('storage_key')
      .where('id', '=', imageId)
      .executeTakeFirstOrThrow();
    return row.storage_key;
  }

  async function uploadAvatar(user: TestUser): Promise<string> {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(PNG_1X1)], 'me.png', { type: 'image/png' }));
    const res = await ctx.request(user.token).postMultipart('/api/auth/me/avatar', form);
    expect(res.status).toBe(200);
    return (await res.json()).avatar_url.replace('/api/avatars/', '');
  }

  async function userExists(userId: string): Promise<boolean> {
    const row = await db
      .selectFrom('app_user')
      .select('id')
      .where('id', '=', userId)
      .executeTakeFirst();
    return row !== undefined;
  }

  afterAll(async () => {
    await Promise.all(
      uploadedKeys.map((key) => fs.rm(path.join(env.storageDiskRoot, key), { force: true }))
    );
    if (strayProjectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', strayProjectIds).execute();
    }
    await ctx.cleanup();
  });

  it('requires a token', async () => {
    const res = await ctx.request().delete('/api/auth/me', { password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects a missing or non-string password with 422', async () => {
    const user = await ctx.createUser('del-validate');

    const empty = await ctx.request(user.token).delete('/api/auth/me', {});
    expect(empty.status).toBe(422);
    expect(await empty.json()).toMatchObject({ error: 'Validation failed' });

    const wrongType = await ctx.request(user.token).delete('/api/auth/me', { password: 123 });
    expect(wrongType.status).toBe(422);

    expect(await userExists(user.id)).toBe(true);
  });

  it('rejects a wrong password with 401 and changes nothing', async () => {
    const user = await ctx.createUser('del-wrongpass');
    const projectId = await createProject(user, 'kept board');

    const res = await ctx.request(user.token).delete('/api/auth/me', { password: 'not-the-one' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Password is incorrect' });

    expect(await userExists(user.id)).toBe(true);
    const me = await ctx.request(user.token).get('/api/auth/me');
    expect(me.status).toBe(200);
    const project = await ctx.request(user.token).get(`/api/projects/${projectId}`);
    expect(project.status).toBe(200);
  });

  it('deletes the account, its solo projects, and every object they own', async () => {
    const user = await ctx.createUser('del-happy');
    const avatarPath = storagePath(await uploadAvatar(user));
    const projectId = await createProject(user, 'doomed board');
    const taskId = await createTask(user, projectId, 'doomed task');
    const imagePath = storagePath(await uploadTaskImage(user, taskId));

    expect(existsSync(avatarPath)).toBe(true);
    expect(existsSync(imagePath)).toBe(true);

    const res = await ctx.request(user.token).delete('/api/auth/me', { password: user.password });
    expect(res.status).toBe(204);

    expect(await userExists(user.id)).toBe(false);
    const project = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    expect(project).toBeUndefined();
    const task = await db
      .selectFrom('task')
      .select('id')
      .where('id', '=', taskId)
      .executeTakeFirst();
    expect(task).toBeUndefined();
    const images = await db
      .selectFrom('task_image')
      .select('id')
      .where('task_id', '=', taskId)
      .execute();
    expect(images).toEqual([]);
    const columns = await db
      .selectFrom('board_column')
      .select('id')
      .where('project_id', '=', projectId)
      .execute();
    expect(columns).toEqual([]);
    const sessions = await db
      .selectFrom('session')
      .select('id')
      .where('user_id', '=', user.id)
      .execute();
    expect(sessions).toEqual([]);

    expect((await ctx.request(user.token).get('/api/auth/me')).status).toBe(401);
    await expect.poll(() => existsSync(avatarPath), { timeout: 5000 }).toBe(false);
    await expect.poll(() => existsSync(imagePath), { timeout: 5000 }).toBe(false);
  });

  it('revokes personal access tokens and closes their sockets', async () => {
    const user = await ctx.createUser('del-pat');
    const tokenId = newId();
    const created = await ctx
      .request(user.token)
      .post('/api/auth/tokens', { id: tokenId, name: 'agent' });
    expect(created.status).toBe(201);
    const patToken = (await created.json()).token;

    expect((await ctx.request(patToken).get('/api/auth/me')).status).toBe(200);

    const entries = await collectBusEntries(async () => {
      const res = await ctx.request(user.token).delete('/api/auth/me', { password: user.password });
      expect(res.status).toBe(204);
    });

    const rows = await db
      .selectFrom('personal_access_token')
      .select('id')
      .where('user_id', '=', user.id)
      .execute();
    expect(rows).toEqual([]);
    expect((await ctx.request(patToken).get('/api/auth/me')).status).toBe(401);

    const revokes = entries.filter((entry) => entry.type === SESSIONS_REVOKED);
    expect(revokes).toEqual([
      { type: SESSIONS_REVOKED, project_id: null, data: { user_id: user.id } },
      {
        type: SESSIONS_REVOKED,
        project_id: null,
        data: { user_id: user.id, personal_access_token_id: tokenId },
      },
    ]);
  });

  it('refuses with 409 while a created project has other members, and deletes nothing', async () => {
    const owner = await ctx.createUser('del-blocked-owner');
    const member = await ctx.createUser('del-blocked-member');
    const projectId = await createProject(owner, 'Team Rocket');
    expect(
      (
        await ctx
          .request(owner.token)
          .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] })
      ).status
    ).toBe(204);

    const res = await ctx.request(owner.token).delete('/api/auth/me', { password: owner.password });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.blocking_projects).toEqual([{ id: projectId, name: 'Team Rocket' }]);
    expect(body.error).toContain('Team Rocket');

    expect(await userExists(owner.id)).toBe(true);
    const project = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    expect(project?.id).toBe(projectId);
    const members = await db
      .selectFrom('project_member')
      .select('user_id')
      .where('project_id', '=', projectId)
      .execute();
    expect(members).toEqual([{ user_id: member.id }]);
    const sessions = await db
      .selectFrom('session')
      .select('id')
      .where('user_id', '=', owner.id)
      .execute();
    expect(sessions).toHaveLength(1);
    const login = await ctx
      .request()
      .post('/api/auth/login', { email: owner.email, password: owner.password });
    expect(login.status).toBe(200);
  });

  it('lets the owner through once the board is handed over and left', async () => {
    const owner = await ctx.createUser('del-handover-owner');
    const heir = await ctx.createUser('del-handover-heir');
    const projectId = await createProject(owner, 'Handover');
    await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [heir.id] });
    const taskId = await createTask(owner, projectId, 'survives the handover');

    expect(
      (await ctx.request(owner.token).put(`/api/projects/${projectId}/owner`, { user_id: heir.id }))
        .status
    ).toBe(200);
    expect(
      (await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, { user_ids: [] }))
        .status
    ).toBe(204);

    const res = await ctx.request(owner.token).delete('/api/auth/me', { password: owner.password });
    expect(res.status).toBe(204);

    expect(await userExists(owner.id)).toBe(false);
    const board = await ctx.request(heir.token).get(`/api/projects/${projectId}`);
    expect(board.status).toBe(200);
    expect((await board.json()).tasks.map((task: { id: string }) => task.id)).toContain(taskId);
  });

  it("leaves someone else's project intact, drops the membership, and keeps their image", async () => {
    const owner = await ctx.createUser('del-guest-owner');
    const guest = await ctx.createUser('del-guest');
    const projectId = await createProject(owner, 'Host board');
    await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [guest.id] });
    const taskId = await createTask(owner, projectId, 'shared task');
    const hostImagePath = storagePath(await uploadTaskImage(owner, taskId));
    const guestAvatarPath = storagePath(await uploadAvatar(guest));
    await ctx.request(owner.token).put(`/api/tasks/${taskId}/assignees`, { user_ids: [guest.id] });

    const res = await ctx.request(guest.token).delete('/api/auth/me', { password: guest.password });
    expect(res.status).toBe(204);

    // The guest's own object going first proves the hooks ran before the
    // assertion that the host's object survived them.
    await expect.poll(() => existsSync(guestAvatarPath), { timeout: 5000 }).toBe(false);
    expect(existsSync(hostImagePath)).toBe(true);

    const board = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    expect(board.status).toBe(200);
    const payload = await board.json();
    expect(payload.tasks[0].id).toBe(taskId);
    expect(payload.tasks[0].assignee_ids).toEqual([]);
    expect(payload.tasks[0].image_count).toBe(1);

    const members = await db
      .selectFrom('project_member')
      .select('user_id')
      .where('project_id', '=', projectId)
      .execute();
    expect(members).toEqual([]);
    const assignees = await db
      .selectFrom('task_assignee')
      .select('user_id')
      .where('task_id', '=', taskId)
      .execute();
    expect(assignees).toEqual([]);

    const users = await ctx.request(owner.token).get(`/api/users?project_id=${projectId}`);
    expect((await users.json()).users.map((u: { id: string }) => u.id)).not.toContain(guest.id);
  });

  it('publishes the post-state to the members and assignees left behind', async () => {
    const owner = await ctx.createUser('del-events-owner');
    const guest = await ctx.createUser('del-events-guest');
    const projectId = await createProject(owner, 'Events board');
    await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [guest.id] });
    const taskId = await createTask(owner, projectId, 'assigned task');
    await ctx.request(owner.token).put(`/api/tasks/${taskId}/assignees`, { user_ids: [guest.id] });

    const entries = await collectBusEntries(async () => {
      const res = await ctx
        .request(guest.token)
        .delete('/api/auth/me', { password: guest.password });
      expect(res.status).toBe(204);
    });

    const updated = entries.filter((entry) => entry.type === 'project_updated');
    expect(updated).toHaveLength(1);
    expect((updated[0]!.data as { id: string; member_ids: string[] }).id).toBe(projectId);
    expect((updated[0]!.data as { member_ids: string[] }).member_ids).toEqual([]);

    const relations = entries.filter((entry) => entry.type === 'task_relations_set');
    expect(relations).toHaveLength(1);
    expect(relations[0]!.data).toMatchObject({ task_id: taskId, assignee_ids: [] });

    expect(entries.filter((entry) => entry.type === SESSIONS_REVOKED)).toHaveLength(1);
  });

  it('cascades submitted feedback', async () => {
    const user = await ctx.createUser('del-feedback');
    const res = await ctx
      .request(user.token)
      .post('/api/feedback', { id: newId(), message: 'the button is blue' });
    expect(res.status).toBe(201);

    expect(
      (await ctx.request(user.token).delete('/api/auth/me', { password: user.password })).status
    ).toBe(204);

    const rows = await db
      .selectFrom('feedback')
      .select('id')
      .where('user_id', '=', user.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it('publishes only sessions_revoked for an account with nothing attached', async () => {
    const user = await ctx.createUser('del-empty');

    const entries = await collectBusEntries(async () => {
      const res = await ctx.request(user.token).delete('/api/auth/me', { password: user.password });
      expect(res.status).toBe(204);
    });

    expect(entries).toEqual([
      { type: SESSIONS_REVOKED, project_id: null, data: { user_id: user.id } },
    ]);
  });
});
