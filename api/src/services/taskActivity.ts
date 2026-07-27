import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { ActivityValue, TaskActivity, TaskActivityKind, TiptapDoc } from '../schemas/index';

export interface TaskActivityWrite {
  taskId: string;
  kind: TaskActivityKind;
  oldValue?: ActivityValue | null;
  newValue?: ActivityValue | null;
}

// The generated Json column type has an index signature the value interfaces
// cannot satisfy; jsonb parses the text back into the same object.
function serializeValue(value: ActivityValue | null | undefined): string | null {
  return value == null ? null : JSON.stringify(value);
}

export async function recordTaskActivity(
  db: Kysely<DB>,
  actorUserId: string,
  writes: TaskActivityWrite[]
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  await db
    .insertInto('task_activity')
    .values(
      writes.map((write) => ({
        id: crypto.randomUUID(),
        task_id: write.taskId,
        actor_user_id: actorUserId,
        kind: write.kind,
        old_value: serializeValue(write.oldValue),
        new_value: serializeValue(write.newValue),
      }))
    )
    .execute();
}

export interface AssigneeActivityWrite {
  taskId: string;
  kind: 'assignee_added' | 'assignee_removed';
  userId: string;
}

export async function recordAssigneeChanges(
  db: Kysely<DB>,
  actorUserId: string,
  writes: AssigneeActivityWrite[]
): Promise<void> {
  if (writes.length === 0) {
    return;
  }
  const rows = await db
    .selectFrom('app_user')
    .select(['app_user.id', 'app_user.name'])
    .where('app_user.id', 'in', [...new Set(writes.map((write) => write.userId))])
    .execute();
  const names = new Map(rows.map((row) => [row.id, row.name]));

  await recordTaskActivity(
    db,
    actorUserId,
    writes.map((write) => {
      const value = { id: write.userId, name: names.get(write.userId) ?? '' };
      return write.kind === 'assignee_added'
        ? { taskId: write.taskId, kind: write.kind, newValue: value }
        : { taskId: write.taskId, kind: write.kind, oldValue: value };
    })
  );
}

const DESCRIPTION_COALESCE_INTERVAL = '5 minutes';

// Editors autosave on an idle debounce, so one session would otherwise append an
// entry carrying two whole documents every few seconds. A run by a single actor
// extends one entry instead; old_value is never rewritten, so it still holds the
// text from before the session.
export async function recordDescriptionChange(
  db: Kysely<DB>,
  actorUserId: string,
  taskId: string,
  oldDoc: TiptapDoc | null,
  newDoc: TiptapDoc | null
): Promise<void> {
  const last = await db
    .selectFrom('task_activity')
    .select(['id', 'kind', 'actor_user_id'])
    .where('task_id', '=', taskId)
    .where('created_at', '>', sql<Date>`now() - ${DESCRIPTION_COALESCE_INTERVAL}::interval`)
    .orderBy('created_at', 'desc')
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (last?.kind === 'description_changed' && last.actor_user_id === actorUserId) {
    await db
      .updateTable('task_activity')
      .set({ new_value: serializeValue({ doc: newDoc }), created_at: sql<Date>`now()` })
      .where('id', '=', last.id)
      .execute();
    return;
  }

  await recordTaskActivity(db, actorUserId, [
    { taskId, kind: 'description_changed', oldValue: { doc: oldDoc }, newValue: { doc: newDoc } },
  ]);
}

export async function fetchTaskActivity(db: Kysely<DB>, taskId: string): Promise<TaskActivity[]> {
  const rows = await db
    .selectFrom('task_activity')
    .select([
      'task_activity.id',
      'task_activity.kind',
      'task_activity.actor_user_id',
      'task_activity.old_value',
      'task_activity.new_value',
      'task_activity.created_at',
    ])
    .where('task_activity.task_id', '=', taskId)
    .orderBy('task_activity.created_at')
    .orderBy('task_activity.seq')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as TaskActivityKind,
    actor_user_id: row.actor_user_id,
    old_value: row.old_value as TaskActivity['old_value'],
    new_value: row.new_value as TaskActivity['new_value'],
    created_at: row.created_at.toISOString(),
  }));
}
