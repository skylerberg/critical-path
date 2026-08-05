import type { ExpressionBuilder, Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import type { PublicContext } from '../types/index';
import { publishAfterCommit } from './realtime/index';

// An archived blocker leaves the list entirely rather than reading as satisfied,
// unlike a done one, which stays and merely stops counting as open.
export function unarchivedBlockerIds(eb: ExpressionBuilder<DB, 'task'>) {
  return jsonArrayFrom(
    eb
      .selectFrom('task_dependency')
      .innerJoin('task as blocker', 'blocker.id', 'task_dependency.blocker_task_id')
      .select('task_dependency.blocker_task_id')
      .whereRef('task_dependency.blocked_task_id', '=', 'task.id')
      .where('blocker.archived_at', 'is', null)
      .orderBy('task_dependency.blocker_task_id')
  );
}

export interface TaskRelations {
  task_id: string;
  project_id: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
}

export async function fetchTaskRelations(
  db: Kysely<DB>,
  taskIds: string[]
): Promise<TaskRelations[]> {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await db
    .selectFrom('task')
    .select((eb) => [
      'task.id',
      'task.project_id',
      jsonArrayFrom(
        eb
          .selectFrom('task_label')
          .select('task_label.label_id')
          .whereRef('task_label.task_id', '=', 'task.id')
          .orderBy('task_label.label_id')
      ).as('labels'),
      jsonArrayFrom(
        eb
          .selectFrom('task_assignee')
          .select('task_assignee.user_id')
          .whereRef('task_assignee.task_id', '=', 'task.id')
          .orderBy('task_assignee.user_id')
      ).as('assignees'),
      unarchivedBlockerIds(eb).as('blockers'),
    ])
    .where('task.id', 'in', taskIds)
    .execute();

  // Restored in the caller's order rather than left to whatever the scan
  // returns: the bulk routes hand this their request order and serve the
  // result as `{ tasks }`, so an unordered read makes that response
  // non-deterministic for the same request.
  const requestOrder = new Map(taskIds.map((id, index) => [id, index]));
  rows.sort((a, b) => (requestOrder.get(a.id) ?? 0) - (requestOrder.get(b.id) ?? 0));

  return rows.map((row) => ({
    task_id: row.id,
    project_id: row.project_id,
    label_ids: row.labels.map((label) => label.label_id),
    assignee_ids: row.assignees.map((assignee) => assignee.user_id),
    blocker_ids: row.blockers.map((blocker) => blocker.blocker_task_id),
  }));
}

export function publishTaskRelationsSet(
  c: Pick<PublicContext, 'get'>,
  relations: TaskRelations[]
): void {
  for (const relation of relations) {
    publishAfterCommit(c, 'task_relations_set', relation.project_id, {
      task_id: relation.task_id,
      label_ids: relation.label_ids,
      assignee_ids: relation.assignee_ids,
      blocker_ids: relation.blocker_ids,
    });
  }
}
