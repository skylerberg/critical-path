import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { attachmentStorageKeys } from './attachments/index';
import { inProjectLockOrder } from './projectLock';

export interface OwnedProject {
  id: string;
  name: string;
  shared: boolean;
}

// The rows are locked because the account delete is keyed to this snapshot: an
// ownership transfer mid-request would otherwise change which boards the caller
// owns, and a member add has to wait rather than slip in behind the shared check.
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
  // Rows arrive in lock order (project id) and are re-sorted here, because the
  // order a person reads board names in is not the order the locks were taken in.
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map(({ id, name, shared }) => ({ id, name, shared }));
}

// Not every id it is given: a board that gained a member after it was listed is
// left in place, so created_by's ON DELETE RESTRICT aborts the account delete
// rather than taking down a board someone else now uses.
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

// Attachments carry no uploader column, so project ownership is the only handle
// there is: a project the user did not create keeps its objects, since deleting
// one would blank a picture or break a download on someone else's live card.
// Images are attachment rows too, so their keys arrive with the rest.
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
