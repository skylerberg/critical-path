import type { Kysely } from 'kysely';
import type { DB } from '../db/types';

export interface StrippedAssignee {
  task_id: string;
  user_id: string;
}

export async function stripAssigneesForRemovedMembers(
  db: Kysely<DB>,
  projectId: string,
  removedUserIds: string[]
): Promise<StrippedAssignee[]> {
  if (removedUserIds.length === 0) {
    return [];
  }

  return await db
    .deleteFrom('task_assignee')
    .using('task')
    .whereRef('task.id', '=', 'task_assignee.task_id')
    .where('task.project_id', '=', projectId)
    .where('task_assignee.user_id', 'in', removedUserIds)
    .returning(['task_assignee.task_id', 'task_assignee.user_id'])
    .execute();
}
