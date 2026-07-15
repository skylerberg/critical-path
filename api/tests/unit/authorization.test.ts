import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import {
  canAccessProject,
  assertProjectAccess,
  accessibleProjectsFilter,
  isWorkspaceMember,
  usersWithProjectAccess,
} from '../../src/services/authorization';
import { AppError } from '../../src/utils/errors';

const userIds: string[] = [];

async function createUser(name: string): Promise<string> {
  const id = newId();
  await db
    .insertInto('app_user')
    .values({ id, email: uniqueEmail('authz'), password_hash: 'x', name })
    .execute();
  userIds.push(id);
  return id;
}

let creator: string;
let member: string;
let outsider: string;
let workspaceId: string;
let personalProjectId: string;
let workspaceProjectId: string;

beforeAll(async () => {
  creator = await createUser('authz creator');
  member = await createUser('authz member');
  outsider = await createUser('authz outsider');

  workspaceId = newId();
  await db
    .insertInto('workspace')
    .values({ id: workspaceId, name: 'authz workspace', created_by: creator })
    .execute();
  await db
    .insertInto('workspace_member')
    .values([
      { workspace_id: workspaceId, user_id: creator },
      { workspace_id: workspaceId, user_id: member },
    ])
    .execute();

  personalProjectId = newId();
  workspaceProjectId = newId();
  await db
    .insertInto('project')
    .values([
      { id: personalProjectId, name: 'personal', created_by: creator },
      { id: workspaceProjectId, name: 'shared', created_by: creator, workspace_id: workspaceId },
    ])
    .execute();
});

afterAll(async () => {
  await db.deleteFrom('app_user').where('id', 'in', userIds).execute();
});

describe('canAccessProject', () => {
  it('allows the creator of a no-workspace project', async () => {
    expect(await canAccessProject(db, creator, { created_by: creator, workspace_id: null })).toBe(
      true
    );
  });

  it('denies everyone else on a no-workspace project', async () => {
    expect(await canAccessProject(db, member, { created_by: creator, workspace_id: null })).toBe(
      false
    );
  });

  it('allows workspace members on a workspace project', async () => {
    const project = { created_by: creator, workspace_id: workspaceId };
    expect(await canAccessProject(db, member, project)).toBe(true);
    expect(await canAccessProject(db, outsider, project)).toBe(false);
  });

  it('allows the creator even after the project moves to a workspace they left', async () => {
    expect(
      await canAccessProject(db, creator, { created_by: creator, workspace_id: workspaceId })
    ).toBe(true);
  });
});

describe('assertProjectAccess', () => {
  it('returns the project row for an allowed user', async () => {
    const row = await assertProjectAccess(db, member, workspaceProjectId);
    expect(row.id).toBe(workspaceProjectId);
    expect(row.workspace_id).toBe(workspaceId);
  });

  it('throws 404 for a user without access', async () => {
    await expect(assertProjectAccess(db, outsider, personalProjectId)).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(assertProjectAccess(db, outsider, personalProjectId)).rejects.toBeInstanceOf(
      AppError
    );
  });

  it('throws 404 for a nonexistent project', async () => {
    await expect(assertProjectAccess(db, creator, newId())).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('accessibleProjectsFilter', () => {
  async function accessibleIds(userId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('project')
      .select('project.id')
      .where(accessibleProjectsFilter(userId))
      .execute();
    return rows.map((row) => row.id);
  }

  it('returns created and workspace-shared projects only', async () => {
    expect((await accessibleIds(creator)).sort()).toEqual(
      [personalProjectId, workspaceProjectId].sort()
    );
    expect(await accessibleIds(member)).toEqual([workspaceProjectId]);
    expect(await accessibleIds(outsider)).toEqual([]);
  });
});

describe('isWorkspaceMember', () => {
  it('reflects membership rows', async () => {
    expect(await isWorkspaceMember(db, workspaceId, member)).toBe(true);
    expect(await isWorkspaceMember(db, workspaceId, outsider)).toBe(false);
  });
});

describe('usersWithProjectAccess', () => {
  it('returns only the creator for a no-workspace project', async () => {
    const users = await usersWithProjectAccess(db, personalProjectId);
    expect(users.map((u) => u.id)).toEqual([creator]);
  });

  it('returns creator and workspace members for a workspace project', async () => {
    const users = await usersWithProjectAccess(db, workspaceProjectId);
    expect(users.map((u) => u.id).sort()).toEqual([creator, member].sort());
  });

  it('includes users still referenced by a task_assignee row', async () => {
    const columnId = newId();
    const taskId = newId();
    await db
      .insertInto('board_column')
      .values({ id: columnId, project_id: workspaceProjectId, name: 'col', position: 1000 })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: workspaceProjectId,
        column_id: columnId,
        title: 'task',
        position: 1000,
      })
      .execute();
    await db.insertInto('task_assignee').values({ task_id: taskId, user_id: outsider }).execute();

    const users = await usersWithProjectAccess(db, workspaceProjectId);
    expect(users.map((u) => u.id).sort()).toEqual([creator, member, outsider].sort());

    await db.deleteFrom('task').where('id', '=', taskId).execute();
    await db.deleteFrom('board_column').where('id', '=', columnId).execute();
  });
});
