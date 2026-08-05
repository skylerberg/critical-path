import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { MovedTask } from '../schemas/index';
import { AppError } from '../utils/errors';
import { keysBetween } from './sortKey';

export interface ColumnInProject {
  id: string;
  project_id: string;
  name: string;
}

const CROSS_PROJECT_MESSAGE = 'column_id must reference a column in the project';

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
    .select(['board_column.id', 'board_column.project_id', 'board_column.name'])
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

// Anything that appends by reading the column's greatest position has to hold
// this first. Two concurrent moves into one column otherwise read the same max
// and stamp the same positions, and the selections interleave by id instead of
// landing as blocks. Salts 0 and 1 are taken by task covers, dependency cycles
// and attachment quota.
export async function lockColumnTail(db: Kysely<DB>, columnId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${columnId}::text, 2))`.execute(db);
}

// The probe spans archived rows too, so an appended task never collides with
// one that is only hidden.
export async function appendPositions(
  db: Kysely<DB>,
  targetColumnId: string,
  taskIds: readonly string[]
): Promise<MovedTask[]> {
  await lockColumnTail(db, targetColumnId);

  const { max, maxKey } = await db
    .selectFrom('task')
    .select((eb) => [
      eb.fn.max<number | null>('position').as('max'),
      eb.fn.max<string | null>('sort_key').as('maxKey'),
    ])
    .where('column_id', '=', targetColumnId)
    .executeTakeFirstOrThrow();
  const base = max ?? 0;
  const keys = keysBetween(maxKey, null, taskIds.length);

  return taskIds.map((taskId, index) => ({
    id: taskId,
    column_id: targetColumnId,
    position: base + (index + 1) * 1000,
    sort_key: keys[index]!,
  }));
}
