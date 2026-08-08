import type { Kysely, Selectable } from 'kysely';
import type { BoardColumn, DB, ResolvedSortKey } from '../db/types';
import type { MovedTask } from '../schemas/index';
import { AppError } from '../utils/errors';
import { AdvisoryLock, takeAdvisoryLock } from './advisoryLock';
import { assertProjectWrite } from './authorization';
import { keysBetween } from './sortKey';

export interface ColumnInProject {
  id: string;
  project_id: string;
  name: string;
  is_done: boolean;
}

const CROSS_PROJECT_MESSAGE = 'column_id must reference a column in the project';

export const COLUMN_NOT_FOUND = 'Column not found';

// The database refuses a task or series whose column belongs to another
// project, so this is what turns that refusal into a 422 naming the field the
// caller sent.
export async function assertColumnInProject(
  db: Kysely<DB>,
  columnId: string,
  projectId: string,
  messages: { missing?: string; otherProject?: string } = {}
): Promise<ColumnInProject> {
  const column = await db
    .selectFrom('board_column')
    .select([
      'board_column.id',
      'board_column.project_id',
      'board_column.name',
      'board_column.is_done',
    ])
    .where('board_column.id', '=', columnId)
    .executeTakeFirst();
  if (!column) {
    throw new AppError(422, messages.missing ?? CROSS_PROJECT_MESSAGE);
  }
  if (column.project_id !== projectId) {
    throw new AppError(422, messages.otherProject ?? CROSS_PROJECT_MESSAGE);
  }
  return column;
}

// 404 for a caller with no access to the column's project, so an inaccessible
// column stays indistinguishable from a nonexistent one; 403 for a viewer.
export async function assertColumnWrite(
  db: Kysely<DB>,
  userId: string,
  columnId: string
): Promise<Selectable<BoardColumn>> {
  const column = await db
    .selectFrom('board_column')
    .selectAll()
    .where('id', '=', columnId)
    .executeTakeFirst();
  if (!column) {
    throw new AppError(404, COLUMN_NOT_FOUND);
  }
  await assertProjectWrite(db, userId, column.project_id, COLUMN_NOT_FOUND);
  return column;
}

// Anything that appends by reading the column's greatest position has to hold
// this first, and before any row lock it goes on to take: the bulk move locks
// the rows it is moving, so the reverse order deadlocks the two against each
// other. Two concurrent moves into one column otherwise read the same max and
// stamp the same positions, and the selections interleave by id instead of
// landing as blocks.
export async function lockColumnTail(db: Kysely<DB>, columnId: string): Promise<void> {
  await takeAdvisoryLock(db, AdvisoryLock.columnTail, columnId);
}

// A `MovedTask` whose key is still branded, so a caller can write it back
// rather than only serialize it into a response.
export interface AppendedTask extends MovedTask {
  sort_key: ResolvedSortKey;
}

// The probe spans archived rows too, so an appended task never collides with
// one that is only hidden.
export async function appendPositions(
  db: Kysely<DB>,
  targetColumnId: string,
  taskIds: readonly string[]
): Promise<AppendedTask[]> {
  await lockColumnTail(db, targetColumnId);

  const { maxKey } = await db
    .selectFrom('task')
    .select((eb) => eb.fn.max<string | null>('sort_key').as('maxKey'))
    .where('column_id', '=', targetColumnId)
    .executeTakeFirstOrThrow();
  const keys = keysBetween(maxKey, null, taskIds.length);

  return taskIds.map((taskId, index) => ({
    id: taskId,
    column_id: targetColumnId,
    sort_key: keys[index]!,
  }));
}
