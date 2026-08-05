import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { MovedTask } from '../schemas/index';
import { AppError } from '../utils/errors';

export interface ColumnInProject {
  id: string;
  project_id: string;
  name: string;
}

const CROSS_PROJECT_MESSAGE = 'column_id must reference a column in the project';

// The database refuses a task whose column belongs to another project, so this
// is what turns that refusal into a 422 naming the field the caller sent.
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

// The probe spans archived rows too, so an appended task never collides with
// one that is only hidden.
export async function appendPositions(
  db: Kysely<DB>,
  targetColumnId: string,
  taskIds: readonly string[]
): Promise<MovedTask[]> {
  const { max } = await db
    .selectFrom('task')
    .select((eb) => eb.fn.max<number | null>('position').as('max'))
    .where('column_id', '=', targetColumnId)
    .executeTakeFirstOrThrow();
  const base = max ?? 0;

  return taskIds.map((taskId, index) => ({
    id: taskId,
    column_id: targetColumnId,
    position: base + (index + 1) * 1000,
  }));
}
