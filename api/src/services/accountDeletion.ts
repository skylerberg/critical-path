import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { attachmentStorageKeys } from './attachments/index';
import { inProjectLockOrder } from './projectLock';

export interface OwnedProject {
  id: string;
  name: string;
  shared: boolean;
}

// Locks the rows the delete below is keyed to, so an ownership transfer cannot
// hand the caller someone else's board mid-request and a member add has to wait
// rather than slip in behind the shared check.
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
  // Oldest first because a person reads these names; the order the rows were
  // locked in is not this order.
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map(({ id, name, shared }) => ({ id, name, shared }));
}

// Deliberately narrower than "everything the user created": a board that
// changed hands after the guard read must survive, so created_by's
// ON DELETE RESTRICT aborts the account delete rather than deleting the board
// out from under its new owner.
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

// Only keys from projects the user created: neither images nor attachments
// record an uploader, and deleting the object would blank a picture or break a
// download on someone else's live card.
export async function storageKeysOwnedBy(
  db: Kysely<DB>,
  userId: string,
  avatarStorageKey: string | null
): Promise<string[]> {
  const keys = await attachmentStorageKeys(db, { projectsCreatedBy: userId });
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
// outlives the membership, so a project the user has left can still hold a card
// with their chip on it.
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
