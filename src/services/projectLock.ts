import type { Kysely, SelectQueryBuilder } from 'kysely';
import type { DB } from '../db/types';
import { AppError } from '../utils/errors';
import { PROJECT_COLUMNS, type ProjectRow } from './projectListItem';

// The one order in which more than one project row may be locked: two lockers
// that disagree deadlock as soon as their sets overlap. The key is the order
// because every locker already has it; a list wanting some other order can be
// sorted once the rows are held.
export function inProjectLockOrder<O>(
  qb: SelectQueryBuilder<DB, 'project', O>
): SelectQueryBuilder<DB, 'project', O> {
  return qb.orderBy('project.id').forUpdate();
}

// Every project_member write decides what to write from created_by, so that read
// has to hold the project row: without the lock an ownership transfer can commit
// mid-request and leave the new creator holding a member row. Writers of a
// project's invitations hold it too, so a revoke cannot land inside a re-invite
// about to recreate the row it revoked.
export async function lockProject(db: Kysely<DB>, projectId: string): Promise<ProjectRow> {
  const row = await db
    .selectFrom('project')
    .select(PROJECT_COLUMNS)
    .where('id', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  if (!row) {
    throw new AppError(404, 'Project not found');
  }
  return row;
}
