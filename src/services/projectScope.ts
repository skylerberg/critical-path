import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { AppError } from '../utils/errors';
import { projectAccessIdsAmong, type ProjectAccessFields } from './authorization';

export async function assertLabelsInProject(
  db: Kysely<DB>,
  labelIds: string[],
  projectId: string
): Promise<void> {
  if (labelIds.length === 0) {
    return;
  }
  const rows = await db
    .selectFrom('label')
    .select('label.id')
    .where('label.id', 'in', labelIds)
    .where('label.project_id', '=', projectId)
    .execute();
  if (rows.length !== labelIds.length) {
    throw new AppError(422, 'label_ids must reference labels in the project');
  }
}

export async function assertAssigneesHaveProjectAccess(
  db: Kysely<DB>,
  userIds: string[],
  project: ProjectAccessFields
): Promise<void> {
  const withAccess = await projectAccessIdsAmong(db, project, userIds);
  if (withAccess.length !== userIds.length) {
    throw new AppError(422, 'assignee user ids must reference users with access to the project');
  }
}
