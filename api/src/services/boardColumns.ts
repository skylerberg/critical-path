import { sql, type Kysely, type RawBuilder, type Selectable } from 'kysely';
import type { BoardColumn, DB, ResolvedSortKey } from '../db/types';
import type { MovedTask } from '../schemas/index';
import { AppError } from '../utils/errors';
import { AdvisoryLock, takeAdvisoryLock } from './advisoryLock';
import { assertProjectWrite } from './authorization';
import { appendKeys, keysBetween } from './sortKey';
import { recordTaskActivity } from './taskActivity';

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

// The `from (values …) as v(id, sort_key)` body every bulk position write joins
// against, so a batch is one statement rather than one per card. The casts are
// not optional: a bind parameter inside a VALUES list has no type Postgres can
// infer for the column.
export function positionValues(tasks: readonly MovedTask[]): RawBuilder<unknown> {
  return sql`(values ${sql.join(
    tasks.map((task) => sql`(${task.id}::uuid, ${task.sort_key}::text)`)
  )}) as v(id, sort_key)`;
}

// Empties one column into another. Every task named here already sits in the
// source column and is moving out of it — the routes refuse a target equal to
// the source — so unlike `relocateSelectedTasks` in ./taskBulk there is no
// same-column case to keep a column_since for, and no client-supplied id needing
// the project and archived predicates. Archived cards move too: the column is
// about to be deleted underneath them.
export async function relocateColumnTasks(
  db: Kysely<DB>,
  actorUserId: string,
  taskIds: readonly string[],
  source: { id: string; name: string },
  target: { id: string; name: string }
): Promise<MovedTask[]> {
  if (taskIds.length === 0) {
    return [];
  }

  const movedTasks = await appendPositions(db, target.id, taskIds);

  await sql`
    update task
    set column_id = ${target.id}::uuid,
        sort_key = v.sort_key,
        column_since = now()
    from ${positionValues(movedTasks)}
    where task.id = v.id
  `.execute(db);

  await recordTaskActivity(
    db,
    actorUserId,
    movedTasks.map((task) => ({
      taskId: task.id,
      kind: 'column_changed' as const,
      oldValue: { id: source.id, name: source.name },
      newValue: { id: target.id, name: target.name },
    }))
  );

  return movedTasks;
}

// A one-shot reorder within a single column: re-stamps evenly spaced positions
// so the result commits to manual order. No column change, no activity entry,
// no column_since bump.
export async function reorderColumnTasks(
  db: Kysely<DB>,
  column: { id: string },
  taskIds: readonly string[]
): Promise<MovedTask[]> {
  if (new Set(taskIds).size !== taskIds.length) {
    throw new AppError(422, 'task_ids must not contain duplicates');
  }
  // The run below is allocated past the column's tail, so this is held for the
  // same reason every other appender holds it, and before the rows the write
  // goes on to lock: the reverse order deadlocks against the bulk move.
  await lockColumnTail(db, column.id);

  const rows = await db
    .selectFrom('task')
    .select('id')
    .where('column_id', '=', column.id)
    .where('archived_at', 'is', null)
    .where('id', 'in', [...taskIds])
    .execute();
  // The schema guarantees a non-empty, all-unique id list, so a short read
  // means an id is archived, in another column, or unknown.
  if (rows.length !== taskIds.length) {
    throw new AppError(422, 'task_ids must reference unarchived tasks in this column');
  }

  // Allocated after the column's tail rather than from scratch: the unique index
  // spans archived rows, and a run starting at the first key would collide with
  // whatever an archived card is still holding.
  const keys = await appendKeys(db, 'task', column.id, taskIds.length);

  // The check above is a read, so a card can still leave the column before the
  // write lands; without the predicates below its position would be stamped into
  // whatever column it moved to.
  const movedTasks = taskIds.map((taskId, index) => ({
    id: taskId,
    column_id: column.id,
    sort_key: keys[index]!,
  }));

  const written = await sql<{ id: string }>`
    update task
    set sort_key = v.sort_key
    from ${positionValues(movedTasks)}
    where task.id = v.id
      and task.column_id = ${column.id}
      and task.archived_at is null
    returning task.id
  `.execute(db);

  // Reporting a position for a row those predicates skipped would tell every
  // client the card sits somewhere it does not, through the response and the
  // event alike, so the answer is what the write actually touched.
  const touched = new Set(written.rows.map((row) => row.id));
  return movedTasks.filter((task) => touched.has(task.id));
}
