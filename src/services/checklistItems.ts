import type { Kysely, Selectable } from 'kysely';
import type { DB, Project } from '../db/types';
import { AppError } from '../utils/errors';
import { assertProjectWrite } from './authorization';

export const CHECKLIST_ITEM_NOT_FOUND = 'Checklist item not found';

// Checklists are card content rather than discussion, so unlike comments every
// mutation demands write access: 404 for a caller with none, 403 for a viewer.
export async function assertChecklistItemWrite(
  db: Kysely<DB>,
  userId: string,
  itemId: string
): Promise<{ task_id: string; project: Selectable<Project> }> {
  const row = await db
    .selectFrom('checklist_item')
    .innerJoin('task', 'task.id', 'checklist_item.task_id')
    .select(['checklist_item.task_id', 'task.project_id'])
    .where('checklist_item.id', '=', itemId)
    .executeTakeFirst();
  if (!row) {
    throw new AppError(404, CHECKLIST_ITEM_NOT_FOUND);
  }
  const project = await assertProjectWrite(db, userId, row.project_id, CHECKLIST_ITEM_NOT_FOUND);
  return { task_id: row.task_id, project };
}
