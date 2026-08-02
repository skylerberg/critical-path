import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
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
