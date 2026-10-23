import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { attachmentStorageKeys } from './attachments/index';
import { inProjectLockOrder } from './projectLock';

export interface OwnedProject {
  id: string;
  name: string;
  shared: boolean;
}

// The projects this user owns, locked so the snapshot the delete is keyed to
// cannot move underneath it: an ownership transfer could otherwise hand the
// caller someone else's board mid-request, and a member add has to wait rather
// than slip in behind the `shared` check.
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
  // Locked by id, then listed by creation date: these names are read by a person,
  // and the order the rows are locked in is not this query's to choose.
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    .map(({ id, name, shared }) => ({ id, name, shared }));
}

// Deliberately narrower than "every project created_by this user": a board that
// changed hands after the list was read must survive, so it is left for
// created_by's ON DELETE RESTRICT to abort the whole account delete rather than
// have this take down a board that is no longer theirs.
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
// neither table has an uploader column, and deleting the object would blank a
// picture or break a download on someone else's live card.
export async function storageKeysOwnedBy(
  db: Kysely<DB>,
  userId: string,
  avatarStorageKey: string | null
): Promise<string[]> {
  // Image keys come from attachmentStorageKeys too, because images are rows in
  // that table: every deletion path stays on one funnel.
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
