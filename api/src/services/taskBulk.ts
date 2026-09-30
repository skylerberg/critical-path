import { sql, type Kysely } from 'kysely';
import type { DB, ResolvedSortKey } from '../db/types';
import type { MovedTask } from '../schemas/index';
import {
  appendPositions,
  positionValues,
  type AppendedTask,
  type ColumnInProject,
} from './boardColumns';
import { keysBetween } from './sortKey';
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
  // bulk writes serialize instead of deadlocking.
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
 * The cards the caller saw on either side of where the selection was dropped.
 * Either may have gone by the time the request lands, which is why there are
 * two of them.
 */
export interface SelectionAnchors {
  afterTaskId?: string;
  beforeTaskId?: string;
}

async function liveKeyIn(
  db: Kysely<DB>,
  columnId: string,
  taskId: string | undefined
): Promise<ResolvedSortKey | null> {
  if (taskId === undefined) {
    return null;
  }
  const row = await db
    .selectFrom('task')
    .select('sort_key')
    .where('id', '=', taskId)
    .where('column_id', '=', columnId)
    .where('archived_at', 'is', null)
    .executeTakeFirst();
  return row?.sort_key ?? null;
}

// Bounded by the nearest key in the whole column — archived rows and the rows
// being moved included — so nothing sits inside the gap. That is what lets one
// UPDATE rewrite the batch: the unique index is checked row by row as it goes,
// and a new key equal to a moving row's old one would trip it whenever that row
// happened to be written second.
async function gapBeside(
  db: Kysely<DB>,
  columnId: string,
  anchors: SelectionAnchors
): Promise<{ low: string | null; high: string | null } | null> {
  const after = await liveKeyIn(db, columnId, anchors.afterTaskId);
  if (after !== null) {
    const { high } = await db
      .selectFrom('task')
      .select((eb) => eb.fn.min<string | null>('sort_key').as('high'))
      .where('column_id', '=', columnId)
      .where('sort_key', '>', after)
      .executeTakeFirstOrThrow();
    return { low: after, high };
  }
  const before = await liveKeyIn(db, columnId, anchors.beforeTaskId);
  if (before !== null) {
    const { low } = await db
      .selectFrom('task')
      .select((eb) => eb.fn.max<string | null>('sort_key').as('low'))
      .where('column_id', '=', columnId)
      .where('sort_key', '<', before)
      .executeTakeFirstOrThrow();
    return { low, high: before };
  }
  return null;
}

// Straight after the after-anchor while it is still a live card of the column,
// else straight before the before-anchor, else the end — the same fallbacks the
// web client's `placeBetweenNeighbors` takes when it replays a queued drag.
async function selectionPositions(
  db: Kysely<DB>,
  targetColumnId: string,
  taskIds: readonly string[],
  anchors: SelectionAnchors
): Promise<AppendedTask[]> {
  const gap = await gapBeside(db, targetColumnId, anchors);
  if (gap === null) {
    return appendPositions(db, targetColumnId, taskIds);
  }
  const keys = keysBetween(gap.low, gap.high, taskIds.length);
  return taskIds.map((taskId, index) => ({
    id: taskId,
    column_id: targetColumnId,
    sort_key: keys[index]!,
  }));
}

/**
 * Places the rows contiguously in the order they arrive, each carrying its own
 * source column into the activity log — a selection spans columns, so one source
 * for the whole batch would misreport most of it. Unlike `relocateColumnTasks` in
 * ./boardColumns, the ids come from the client and can already be in the target
 * column, which is where the project and archived predicates and the
 * column_since case come from.
 *
 * The caller holds the target's tail lock, which the gap read needs as much as
 * an append does: two selections dropped into one gap would otherwise read the
 * same bounds and generate the same keys.
 */
export async function relocateSelectedTasks(
  db: Kysely<DB>,
  actorUserId: string,
  projectId: string,
  rows: readonly BulkTaskRow[],
  target: ColumnInProject,
  anchors: SelectionAnchors
): Promise<MovedTask[]> {
  if (rows.length === 0) {
    return [];
  }

  const movedTasks = await selectionPositions(
    db,
    target.id,
    rows.map((row) => row.id),
    anchors
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
