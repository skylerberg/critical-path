import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import {
  assignedTasksElsewhere,
  memberProjectIds,
  ownedSharedProjects,
  storageKeysOwnedBy,
} from '../../src/services/accountDeletion';

const userIds: string[] = [];

async function createUser(name: string): Promise<string> {
  const id = newId();
  await db
    .insertInto('app_user')
    .values({ id, email: uniqueEmail('acctdel'), password_hash: 'x', name })
    .execute();
  userIds.push(id);
  return id;
}

async function createProject(name: string, createdBy: string, createdAt: Date): Promise<string> {
  const id = newId();
  await db
    .insertInto('project')
    .values({ id, name, created_by: createdBy, created_at: createdAt })
    .execute();
  return id;
}

async function createTask(projectId: string, title: string): Promise<string> {
  const columnId = newId();
  await db
    .insertInto('board_column')
    .values({ id: columnId, project_id: projectId, name: 'Todo', position: 1000 })
    .execute();
  const taskId = newId();
  await db
    .insertInto('task')
    .values({ id: taskId, project_id: projectId, column_id: columnId, title, position: 1000 })
    .execute();
  return taskId;
}

async function attachImage(taskId: string, storageKey: string): Promise<void> {
  await db
    .insertInto('task_image')
    .values({
      id: newId(),
      task_id: taskId,
      storage_key: storageKey,
      filename: 'shot.webp',
      content_type: 'image/webp',
      size_bytes: 12,
    })
    .execute();
}

let owner: string;
let other: string;
let soloProjectId: string;
let sharedProjectId: string;
let laterSharedProjectId: string;
let foreignProjectId: string;
let foreignTaskId: string;
let assignedElsewhereTaskId: string;

beforeAll(async () => {
  owner = await createUser('acctdel owner');
  other = await createUser('acctdel other');

  soloProjectId = await createProject('solo', owner, new Date('2024-01-01T00:00:00Z'));
  sharedProjectId = await createProject('shared', owner, new Date('2024-01-02T00:00:00Z'));
  laterSharedProjectId = await createProject(
    'later shared',
    owner,
    new Date('2024-01-03T00:00:00Z')
  );
  foreignProjectId = await createProject('foreign', other, new Date('2024-01-04T00:00:00Z'));

  await db
    .insertInto('project_member')
    .values([
      { project_id: sharedProjectId, user_id: other },
      { project_id: laterSharedProjectId, user_id: other },
      { project_id: foreignProjectId, user_id: owner },
    ])
    .execute();

  const soloTaskId = await createTask(soloProjectId, 'solo task');
  await attachImage(soloTaskId, 'owned-image-key');

  foreignTaskId = await createTask(foreignProjectId, 'foreign task');
  await attachImage(foreignTaskId, 'foreign-image-key');

  assignedElsewhereTaskId = foreignTaskId;
  await db
    .insertInto('task_assignee')
    .values([
      { task_id: soloTaskId, user_id: owner },
      { task_id: assignedElsewhereTaskId, user_id: owner },
    ])
    .execute();
});

afterAll(async () => {
  await db.deleteFrom('project').where('created_by', 'in', userIds).execute();
  await db.deleteFrom('app_user').where('id', 'in', userIds).execute();
});

describe('ownedSharedProjects', () => {
  it('returns only created projects that have a member row, oldest first', async () => {
    expect(await ownedSharedProjects(db, owner)).toEqual([
      { id: sharedProjectId, name: 'shared' },
      { id: laterSharedProjectId, name: 'later shared' },
    ]);
  });

  it('ignores projects the user is merely a member of', async () => {
    expect(await ownedSharedProjects(db, other)).toEqual([
      { id: foreignProjectId, name: 'foreign' },
    ]);
  });

  it('returns nothing for a user with no projects at all', async () => {
    const stranger = await createUser('acctdel stranger');
    expect(await ownedSharedProjects(db, stranger)).toEqual([]);
  });
});

describe('storageKeysOwnedBy', () => {
  it('returns the avatar key plus image keys from created projects only', async () => {
    const keys = await storageKeysOwnedBy(db, owner, 'avatar-key');
    expect(keys).toEqual(['avatar-key', 'owned-image-key']);
    expect(keys).not.toContain('foreign-image-key');
  });

  it('omits the avatar when the user has none', async () => {
    expect(await storageKeysOwnedBy(db, owner, null)).toEqual(['owned-image-key']);
  });

  it('returns nothing for a user with no avatar and no created projects', async () => {
    const stranger = await createUser('acctdel keyless');
    expect(await storageKeysOwnedBy(db, stranger, null)).toEqual([]);
  });

  it('does not return an image key from a project the user only belongs to', async () => {
    expect(await storageKeysOwnedBy(db, other, null)).toEqual(['foreign-image-key']);
  });
});

describe('memberProjectIds', () => {
  it('returns the projects the user has a member row in', async () => {
    expect(await memberProjectIds(db, owner)).toEqual([foreignProjectId]);
    expect((await memberProjectIds(db, other)).sort()).toEqual(
      [sharedProjectId, laterSharedProjectId].sort()
    );
  });
});

describe('assignedTasksElsewhere', () => {
  it("returns assignments in other people's projects and skips the user's own", async () => {
    expect(await assignedTasksElsewhere(db, owner)).toEqual([
      { task_id: assignedElsewhereTaskId, project_id: foreignProjectId },
    ]);
  });

  it('returns nothing for a user with no assignments', async () => {
    expect(await assignedTasksElsewhere(db, other)).toEqual([]);
  });
});
