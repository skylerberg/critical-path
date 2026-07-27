import type { Kysely } from 'kysely';
import type { DB } from '../db/types';

export async function ownedSharedProjects(
  db: Kysely<DB>,
  userId: string
): Promise<Array<{ id: string; name: string }>> {
  return await db
    .selectFrom('project')
    .select(['project.id', 'project.name'])
    .where('project.created_by', '=', userId)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('project_member')
          .select('project_member.user_id')
          .whereRef('project_member.project_id', '=', 'project.id')
      )
    )
    .orderBy('project.created_at')
    .orderBy('project.id')
    .execute();
}

// Images uploaded into projects the user did not create are excluded: task_image
// has no uploader column, the row outlives the account with its project, and
// deleting the object would blank a picture on someone else's live card.
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
  const keys = rows.map((row) => row.storage_key);
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
