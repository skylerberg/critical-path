import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { attachmentStorageKeys } from './attachments/index';
import { inProjectLockOrder } from './projectLock';

export interface OwnedProject {
  id: string;
  name: string;
  shared: boolean;
}

// Locked because the delete is keyed to this snapshot: an ownership transfer
// can hand the caller someone else's board mid-request, and a member add on a
// row in here has to wait rather than slip in behind the shared check.
export async function lockOwnedProjects(db: Kysely<DB>, userId: string): Promise<OwnedProject[]> {
  const rows = await db
    .selectFrom('project')
    .select((eb) => [
      'project.id',
      'project.name',
      'project.created_at',
      eb
        .exists(
          eb
            .selectFrom('project_member')
            .select('project_member.user_id')
            .whereRef('project_member.project_id', '=', 'project.id')
        )
        .$castTo<boolean>()
        .as('shared'),
    ])
    .where('project.created_by', '=', userId)
    .$call(inProjectLockOrder)
    .execute();
  // Taken in one order and listed in another: these names are read by a person,
  // and the order rows are locked in is not up to this query.
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map(({ id, name, shared }) => ({ id, name, shared }));
}

// Deliberately narrower than "everything created_by the user": a board that
// became theirs after the guard read must survive, so that created_by's
// ON DELETE RESTRICT aborts the account delete instead of taking it down.
export async function deleteUnsharedProjects(db: Kysely<DB>, projectIds: string[]): Promise<void> {
  if (projectIds.length === 0) {
    return;
  }
  await db
    .deleteFrom('project')
    .where('id', 'in', projectIds)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('project_member')
            .select('project_member.user_id')
            .whereRef('project_member.project_id', '=', 'project.id')
        )
      )
    )
    .execute();
}

// Images and attachments in projects the user did not create are excluded:
// neither table has an uploader column, the row outlives the account with its
// project, and deleting the object would blank a picture, or break a download,
// on someone else's live card.
export async function storageKeysOwnedBy(
  db: Kysely<DB>,
  userId: string,
  avatarStorageKey: string | null
): Promise<string[]> {
  const rows = await db
    .selectFrom('task_image')
    .innerJoin('task', 'task.id', 'task_image.task_id')
    .innerJoin('project', 'project.id', 'task.project_id')
    .select('task_image.storage_key')
    .where('project.created_by', '=', userId)
    .execute();
  const keys = [
    ...rows.map((row) => row.storage_key),
    ...(await attachmentStorageKeys(db, { projectsCreatedBy: userId })),
  ];
  return avatarStorageKey === null ? keys : [avatarStorageKey, ...keys];
}

export async function memberProjectIds(db: Kysely<DB>, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('project_member')
    .select('project_member.project_id')
    .where('project_member.user_id', '=', userId)
    .execute();
  return rows.map((row) => row.project_id);
}

// Queried from task_assignee rather than derived from membership: an assignment
// outlives the assignee's membership, so a project they have already left can
// still hold a card with their chip on it.
export async function assignedTasksElsewhere(
  db: Kysely<DB>,
  userId: string
): Promise<Array<{ task_id: string; project_id: string }>> {
  return await db
    .selectFrom('task_assignee')
    .innerJoin('task', 'task.id', 'task_assignee.task_id')
    .innerJoin('project', 'project.id', 'task.project_id')
    .select(['task_assignee.task_id', 'task.project_id'])
    .where('task_assignee.user_id', '=', userId)
    .where('project.created_by', '!=', userId)
    .execute();
}
