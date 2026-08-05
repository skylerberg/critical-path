import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import { insertTaskImages } from '../../src/services/attachments/images';
import {
  assignedTasksElsewhere,
  deleteUnsharedProjects,
  lockOwnedProjects,
  memberProjectIds,
  storageKeysOwnedBy,
} from '../../src/services/accountDeletion';

const userIds: string[] = [];

// Real uuids rather than readable labels: image keys live in a uuid column now,
// and the names below keep the assertions legible.
const OWNED_IMAGE_KEY = newId();
const FOREIGN_IMAGE_KEY = newId();

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
  const id = newId();
  await insertTaskImages(db, [
    {
      id,
      task_id: taskId,
      storage_key: storageKey,
      filename: 'shot.webp',
      content_type: 'image/webp',
      size_bytes: 12,
      is_cover: false,
    },
  ]);
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
  await attachImage(soloTaskId, OWNED_IMAGE_KEY);

  foreignTaskId = await createTask(foreignProjectId, 'foreign task');
  await attachImage(foreignTaskId, FOREIGN_IMAGE_KEY);

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

describe('lockOwnedProjects', () => {
  it('returns every created project, flagging the ones with a member row, oldest first', async () => {
    expect(await lockOwnedProjects(db, owner)).toEqual([
      { id: soloProjectId, name: 'solo', shared: false },
      { id: sharedProjectId, name: 'shared', shared: true },
      { id: laterSharedProjectId, name: 'later shared', shared: true },
    ]);
  });

  it('ignores projects the user is merely a member of', async () => {
    expect(await lockOwnedProjects(db, other)).toEqual([
      { id: foreignProjectId, name: 'foreign', shared: true },
    ]);
  });

  it('returns nothing for a user with no projects at all', async () => {
    const stranger = await createUser('acctdel stranger');
    expect(await lockOwnedProjects(db, stranger)).toEqual([]);
  });
});

describe('deleteUnsharedProjects', () => {
  async function projectExists(projectId: string): Promise<boolean> {
    const row = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', projectId)
      .executeTakeFirst();
    return row !== undefined;
  }

  it('deletes the ids it is given', async () => {
    const user = await createUser('acctdel deleter');
    const projectId = await createProject('doomed', user, new Date('2024-02-01T00:00:00Z'));

    await deleteUnsharedProjects(db, [projectId]);

    expect(await projectExists(projectId)).toBe(false);
  });

  it('leaves a project the user created but that was not in the id set', async () => {
    const user = await createUser('acctdel transferee');
    const transferred = await createProject('handed over', user, new Date('2024-02-02T00:00:00Z'));
    const listed = await createProject('listed', user, new Date('2024-02-03T00:00:00Z'));

    await deleteUnsharedProjects(db, [listed]);

    expect(await projectExists(transferred)).toBe(true);
    expect(await projectExists(listed)).toBe(false);
  });

  it('leaves a listed project that gained a member after it was listed', async () => {
    const user = await createUser('acctdel raced');
    const latecomer = await createUser('acctdel latecomer');
    const projectId = await createProject('raced', user, new Date('2024-02-04T00:00:00Z'));
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: latecomer })
      .execute();

    await deleteUnsharedProjects(db, [projectId]);

    expect(await projectExists(projectId)).toBe(true);
  });

  it('is a no-op for an empty id set', async () => {
    await expect(deleteUnsharedProjects(db, [])).resolves.toBeUndefined();
  });
});

describe('storageKeysOwnedBy', () => {
  it('returns the avatar key plus image keys from created projects only', async () => {
    const keys = await storageKeysOwnedBy(db, owner, 'avatar-key');
    expect(keys).toEqual(['avatar-key', OWNED_IMAGE_KEY]);
    expect(keys).not.toContain(FOREIGN_IMAGE_KEY);
  });

  it('omits the avatar when the user has none', async () => {
    expect(await storageKeysOwnedBy(db, owner, null)).toEqual([OWNED_IMAGE_KEY]);
  });

  it('returns nothing for a user with no avatar and no created projects', async () => {
    const stranger = await createUser('acctdel keyless');
    expect(await storageKeysOwnedBy(db, stranger, null)).toEqual([]);
  });

  it('does not return an image key from a project the user only belongs to', async () => {
    expect(await storageKeysOwnedBy(db, other, null)).toEqual([FOREIGN_IMAGE_KEY]);
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
