import type { Kysely, Selectable } from 'kysely';
import type { DB, Project } from '../db/types';
import { AppError } from '../utils/errors';
import { assertProjectAccess } from './authorization';

export const COMMENT_NOT_FOUND = 'Comment not found';

// Edit and delete are author-only; another member's comment answers 404 rather
// than 403 so the response cannot confirm it exists.
export async function assertOwnComment(
  db: Kysely<DB>,
  userId: string,
  commentId: string
): Promise<{ task_id: string; project: Selectable<Project> }> {
  const row = await db
    .selectFrom('task_comment')
    .innerJoin('task', 'task.id', 'task_comment.task_id')
    .select(['task_comment.task_id', 'task_comment.user_id', 'task.project_id'])
    .where('task_comment.id', '=', commentId)
    .executeTakeFirst();
  if (!row) {
    throw new AppError(404, COMMENT_NOT_FOUND);
  }
  const project = await assertProjectAccess(db, userId, row.project_id, COMMENT_NOT_FOUND);
  if (row.user_id !== userId) {
    throw new AppError(404, COMMENT_NOT_FOUND);
  }
  return { task_id: row.task_id, project };
}
