import type { Kysely } from 'kysely';
import type { DB } from '../db/types';

export interface StrippedAssignee {
  task_id: string;
  user_id: string;
}

export async function stripAssigneesForProjectScope(
  db: Kysely<DB>,
  projectId: string,
  createdBy: string | null,
  workspaceId: string | null
): Promise<StrippedAssignee[]> {
  let query = db
    .deleteFrom('task_assignee')
    .using('task')
    .whereRef('task.id', '=', 'task_assignee.task_id')
    .where('task.project_id', '=', projectId);

  if (createdBy !== null) {
    query = query.where('task_assignee.user_id', '!=', createdBy);
  }
  if (workspaceId !== null) {
    query = query.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('workspace_member')
            .select('workspace_member.user_id')
            .where('workspace_member.workspace_id', '=', workspaceId)
            .whereRef('workspace_member.user_id', '=', 'task_assignee.user_id')
        )
      )
    );
  }

  return await query.returning(['task_assignee.task_id', 'task_assignee.user_id']).execute();
}

export async function stripAssigneesForRemovedMembers(
  db: Kysely<DB>,
  workspaceId: string,
  removedUserIds: string[]
): Promise<StrippedAssignee[]> {
  if (removedUserIds.length === 0) {
    return [];
  }

  return await db
    .deleteFrom('task_assignee')
    .using('task')
    .whereRef('task.id', '=', 'task_assignee.task_id')
    .where('task_assignee.user_id', 'in', removedUserIds)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('project')
          .select('project.id')
          .whereRef('project.id', '=', 'task.project_id')
          .where('project.workspace_id', '=', workspaceId)
          .whereRef('project.created_by', '!=', 'task_assignee.user_id')
      )
    )
    .returning(['task_assignee.task_id', 'task_assignee.user_id'])
    .execute();
}
