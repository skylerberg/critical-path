import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { MovedTask } from '../schemas/index';
import { appendPositions, positionValues, type ColumnInProject } from './boardColumns';
import { recordTaskActivity } from './taskActivity';

export interface BulkTaskRow {
  id: string;
  column_id: string;
  archived_at: Date | null;
}

export interface BulkTargets {
  /** Deduped, in request order. */
  rows: BulkTaskRow[];
  skipped: string[];
}

interface SetDeltaPair {
  task_id: string;
  value: string;
}

export interface SetDelta {
  added: SetDeltaPair[];
  removed: SetDeltaPair[];
}

/**
 * Classifies under a row lock, so the answer cannot go stale before the write
 * that follows it. An id outside the project is never returned, which is what
 * keeps it indistinguishable from an unknown one.
 */
export async function loadBulkTargets(
  db: Kysely<DB>,
  projectId: string,
  taskIds: readonly string[],
  opts: { liveOnly?: boolean } = {}
): Promise<BulkTargets> {
  const ids = [...new Set(taskIds)];
  // Locked in id order: Postgres puts LockRows above Sort, so two overlapping
  // bulk writes serialise instead of deadlocking.
  const rows = await db
    .selectFrom('task')
    .select(['id', 'column_id', 'archived_at'])
    .where('project_id', '=', projectId)
    .where('id', 'in', ids)
    .orderBy('id')
    .forUpdate()
    .execute();

  const byId = new Map(rows.map((row) => [row.id, row]));
  const targets: BulkTaskRow[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row === undefined || (opts.liveOnly === true && row.archived_at !== null)) {
      skipped.push(id);
      continue;
    }
    targets.push(row);
  }
  return { rows: targets, skipped };
}

/**
 * Appends the rows in the order they arrive, each carrying its own source column
 * into the activity log — a selection spans columns, so one source for the whole
 * batch would misreport most of it. Unlike `relocateTasks` in the column routes,
 * the ids come from the client and can already be in the target column, which is
 * where the project and archived predicates and the column_since case come from.
 */
export async function relocateSelectedTasks(
  db: Kysely<DB>,
  actorUserId: string,
  projectId: string,
  rows: readonly BulkTaskRow[],
  target: ColumnInProject
): Promise<MovedTask[]> {
  if (rows.length === 0) {
    return [];
  }

  const movedTasks = await appendPositions(
    db,
    target.id,
    rows.map((row) => row.id)
  );

  // The project and archived predicates guard the gap between the classifying
  // read and this write.
  await sql`
    update task
    set column_id = ${target.id}::uuid,
        sort_key = v.sort_key,
        column_since = case
          when task.column_id = ${target.id}::uuid then task.column_since
          else now()
        end
    from ${positionValues(movedTasks)}
    where task.id = v.id
      and task.project_id = ${projectId}::uuid
      and task.archived_at is null
  `.execute(db);

  const relocated = rows.filter((row) => row.column_id !== target.id);
  if (relocated.length === 0) {
    return movedTasks;
  }

  const sourceNames = new Map(
    (
      await db
        .selectFrom('board_column')
        .select(['board_column.id', 'board_column.name'])
        .where('board_column.id', 'in', [...new Set(relocated.map((row) => row.column_id))])
        .execute()
    ).map((column) => [column.id, column.name])
  );
  await recordTaskActivity(
    db,
    actorUserId,
    relocated.map((row) => ({
      taskId: row.id,
      kind: 'column_changed' as const,
      oldValue: { id: row.column_id, name: sourceNames.get(row.column_id) ?? '' },
      newValue: { id: target.id, name: target.name },
    }))
  );

  return movedTasks;
}

// Sorted so concurrent inserts take their index locks in one order.
function insertPairs(taskIds: readonly string[], values: readonly string[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const taskId of taskIds) {
    for (const value of values) {
      pairs.push([taskId, value]);
    }
  }
  return pairs.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

/**
 * `returning` on both statements yields the exact pairs that changed, which is
 * what keeps the activity log and the published event honest: a card that
 * already carried the label produces no row, no entry and no event member.
 */
export async function applyTaskLabelDelta(
  db: Kysely<DB>,
  taskIds: readonly string[],
  add: readonly string[],
  remove: readonly string[]
): Promise<SetDelta> {
  const removed =
    remove.length === 0
      ? []
      : await db
          .deleteFrom('task_label')
          .where('task_label.task_id', 'in', [...taskIds])
          .where('task_label.label_id', 'in', [...remove])
          .returning(['task_label.task_id', 'task_label.label_id as value'])
          .execute();

  const pairs = insertPairs(taskIds, add);
  const added =
    pairs.length === 0
      ? []
      : await db
          .insertInto('task_label')
          .values(pairs.map(([task_id, label_id]) => ({ task_id, label_id })))
          .onConflict((oc) => oc.columns(['task_id', 'label_id']).doNothing())
          .returning(['task_label.task_id', 'task_label.label_id as value'])
          .execute();

  return { added, removed };
}

export async function applyTaskAssigneeDelta(
  db: Kysely<DB>,
  taskIds: readonly string[],
  add: readonly string[],
  remove: readonly string[]
): Promise<SetDelta> {
  const removed =
    remove.length === 0
      ? []
      : await db
          .deleteFrom('task_assignee')
          .where('task_assignee.task_id', 'in', [...taskIds])
          .where('task_assignee.user_id', 'in', [...remove])
          .returning(['task_assignee.task_id', 'task_assignee.user_id as value'])
          .execute();

  const pairs = insertPairs(taskIds, add);
  const added =
    pairs.length === 0
      ? []
      : await db
          .insertInto('task_assignee')
          .values(pairs.map(([task_id, user_id]) => ({ task_id, user_id })))
          .onConflict((oc) => oc.columns(['task_id', 'user_id']).doNothing())
          .returning(['task_assignee.task_id', 'task_assignee.user_id as value'])
          .execute();

  return { added, removed };
}
