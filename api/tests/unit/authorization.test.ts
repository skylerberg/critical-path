import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import {
  canAccessProject,
  assertProjectAccess,
  accessibleProjectsFilter,
  isProjectMember,
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
let personalProjectId: string;
let sharedProjectId: string;

beforeAll(async () => {
  creator = await createUser('authz creator');
  member = await createUser('authz member');
  outsider = await createUser('authz outsider');

  personalProjectId = newId();
  sharedProjectId = newId();
  await db
    .insertInto('project')
    .values([
      { id: personalProjectId, name: 'personal', created_by: creator },
      { id: sharedProjectId, name: 'shared', created_by: creator },
    ])
    .execute();
  await db
    .insertInto('project_member')
    .values({ project_id: sharedProjectId, user_id: member })
    .execute();
});

afterAll(async () => {
  await db.deleteFrom('app_user').where('id', 'in', userIds).execute();
});

describe('canAccessProject', () => {
  it('allows the creator of a member-less project', async () => {
    expect(
      await canAccessProject(db, creator, { id: personalProjectId, created_by: creator })
    ).toBe(true);
  });

  it('denies everyone else on a member-less project', async () => {
    expect(await canAccessProject(db, member, { id: personalProjectId, created_by: creator })).toBe(
      false
    );
  });

  it('allows members on a shared project', async () => {
    const project = { id: sharedProjectId, created_by: creator };
    expect(await canAccessProject(db, member, project)).toBe(true);
    expect(await canAccessProject(db, outsider, project)).toBe(false);
  });

  it('allows the creator without a member row', async () => {
    expect(await canAccessProject(db, creator, { id: sharedProjectId, created_by: creator })).toBe(
      true
    );
  });
});

describe('assertProjectAccess', () => {
  it('returns the project row for an allowed user', async () => {
    const row = await assertProjectAccess(db, member, sharedProjectId);
    expect(row.id).toBe(sharedProjectId);
    expect(row.created_by).toBe(creator);
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

  it('returns created and member-shared projects only', async () => {
    expect((await accessibleIds(creator)).sort()).toEqual(
      [personalProjectId, sharedProjectId].sort()
    );
    expect(await accessibleIds(member)).toEqual([sharedProjectId]);
    expect(await accessibleIds(outsider)).toEqual([]);
  });
});

describe('isProjectMember', () => {
  it('reflects membership rows', async () => {
    expect(await isProjectMember(db, sharedProjectId, member)).toBe(true);
    expect(await isProjectMember(db, sharedProjectId, outsider)).toBe(false);
    expect(await isProjectMember(db, sharedProjectId, creator)).toBe(false);
  });
});

describe('usersWithProjectAccess', () => {
  it('returns only the creator for a member-less project', async () => {
    const users = await usersWithProjectAccess(db, personalProjectId);
    expect(users.map((u) => u.id)).toEqual([creator]);
  });

  it('returns creator and members for a shared project', async () => {
    const users = await usersWithProjectAccess(db, sharedProjectId);
    expect(users.map((u) => u.id).sort()).toEqual([creator, member].sort());
    for (const user of users) {
      expect(user).toMatchObject({ avatar_url: null });
      expect(typeof user.email).toBe('string');
      expect(typeof user.name).toBe('string');
    }
  });

  it('includes users still referenced by a task_assignee row', async () => {
    const columnId = newId();
    const taskId = newId();
    await db
      .insertInto('board_column')
      .values({ id: columnId, project_id: sharedProjectId, name: 'col', position: 1000 })
      .execute();
    await db
      .insertInto('task')
      .values({
        id: taskId,
        project_id: sharedProjectId,
        column_id: columnId,
        title: 'task',
        position: 1000,
      })
      .execute();
    await db.insertInto('task_assignee').values({ task_id: taskId, user_id: outsider }).execute();

    const users = await usersWithProjectAccess(db, sharedProjectId);
    expect(users.map((u) => u.id).sort()).toEqual([creator, member, outsider].sort());

    await db.deleteFrom('task').where('id', '=', taskId).execute();
    await db.deleteFrom('board_column').where('id', '=', columnId).execute();
  });
});
