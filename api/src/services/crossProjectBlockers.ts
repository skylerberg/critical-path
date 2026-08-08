import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { CrossProjectDependenciesResponse, CrossProjectDependency } from '../schemas/index';
import type { PublicContext } from '../types/index';
import { accessibleProjectsFilter } from './authorization';
import { publishAfterCommit } from './realtime/index';

export interface CrossProjectDependent {
  task_id: string;
  project_id: string;
}

export interface CrossProjectCount extends CrossProjectDependent {
  open_cross_project_blocker_count: number;
}

// Named the way each caller already knows its blockers: a handful of task ids, a
// whole column about to have its done flag flipped, or the projects a delete is
// about to take away. The column form is what keeps a fifty-card flip to one
// query instead of fifty ids marshalled through an `in` list.
export type CrossProjectBlockerScope =
  | { taskIds: readonly string[] }
  | { columnId: string }
  | { projectIds: readonly string[] };

// The blocked tasks that live in a different project from their blocker. Read
// before a cascade deletes the edges, and after anything that changes whether a
// blocker counts as open.
export async function crossProjectDependentsOf(
  db: Kysely<DB>,
  scope: CrossProjectBlockerScope
): Promise<CrossProjectDependent[]> {
  if ('taskIds' in scope && scope.taskIds.length === 0) {
    return [];
  }
  if ('projectIds' in scope && scope.projectIds.length === 0) {
    return [];
  }

  const base = db
    .selectFrom('task_dependency')
    .innerJoin('task as blocked', 'blocked.id', 'task_dependency.blocked_task_id')
    .innerJoin('task as blocker', 'blocker.id', 'task_dependency.blocker_task_id')
    .select(['blocked.id as task_id', 'blocked.project_id'])
    .whereRef('blocked.project_id', '<>', 'blocker.project_id')
    .distinct();

  const scoped =
    'taskIds' in scope
      ? base.where('task_dependency.blocker_task_id', 'in', [...scope.taskIds])
      : 'columnId' in scope
        ? base.where('blocker.column_id', '=', scope.columnId)
        : base.where('blocker.project_id', 'in', [...scope.projectIds]);

  return await scoped.execute();
}

// The one place a remote blocker's done state is resolved. Driven off the
// requested ids rather than off the edges, so a task whose last cross-project
// blocker just went away is reset to 0 rather than left untouched. Returns only
// the rows that actually moved, which is exactly what has to be published.
export async function refreshCrossProjectBlockerCounts(
  db: Kysely<DB>,
  blockedTaskIds: readonly string[]
): Promise<CrossProjectCount[]> {
  if (blockedTaskIds.length === 0) {
    return [];
  }
  const result = await sql<CrossProjectCount>`
    update task
    set open_cross_project_blocker_count = counted.n
    from (
      select
        blocked.id,
        blocked.project_id,
        (
          select count(*)::int
          from task_dependency d
          join task blocker on blocker.id = d.blocker_task_id
          join board_column bc on bc.id = blocker.column_id
          where d.blocked_task_id = blocked.id
            and blocker.project_id <> blocked.project_id
            and blocker.archived_at is null
            and bc.is_done = false
        ) as n
      from task blocked
      where blocked.id = any(${[...blockedTaskIds]}::uuid[])
    ) as counted
    where task.id = counted.id
      and task.open_cross_project_blocker_count is distinct from counted.n
    returning
      task.id as task_id,
      counted.project_id,
      counted.n as open_cross_project_blocker_count
  `.execute(db);
  return result.rows;
}

// Its own event type rather than a task_relations_set fan-out: this reaches a
// project the actor may not belong to, where the change leaves no activity or
// comment row, so a type that raises the unseen dot would dot a board that
// nothing in it explains and no amount of looking could clear.
export function publishCrossProjectBlockerCounts(
  c: Pick<PublicContext, 'get'>,
  counts: readonly CrossProjectCount[]
): void {
  const byProject = new Map<string, CrossProjectCount[]>();
  for (const count of counts) {
    const existing = byProject.get(count.project_id);
    if (existing) {
      existing.push(count);
    } else {
      byProject.set(count.project_id, [count]);
    }
  }
  for (const [projectId, group] of byProject) {
    publishAfterCommit(c, 'cross_project_blockers_changed', projectId, {
      tasks: group.map((count) => ({
        task_id: count.task_id,
        open_cross_project_blocker_count: count.open_cross_project_blocker_count,
      })),
    });
  }
}

// One direction of a task's cross-project edges, split into what the caller may
// read and a count of what they may not. The split is structural: an
// unreadable row is never built, so nothing downstream can leak one by
// forgetting to blank a field.
async function readEdges(
  db: Kysely<DB>,
  userId: string,
  taskId: string,
  direction: 'blocked_by' | 'blocking'
): Promise<{ visible: CrossProjectDependency[]; hiddenOpen: number }> {
  const near = direction === 'blocked_by' ? 'blocked_task_id' : 'blocker_task_id';
  const far = direction === 'blocked_by' ? 'blocker_task_id' : 'blocked_task_id';

  const rows = await db
    .selectFrom('task_dependency')
    .innerJoin('task as near', `near.id`, `task_dependency.${near}`)
    .innerJoin('task as far', `far.id`, `task_dependency.${far}`)
    .innerJoin('project as far_project', 'far_project.id', 'far.project_id')
    .innerJoin('board_column as far_column', 'far_column.id', 'far.column_id')
    .select((eb) => [
      'far.id as task_id',
      'far.project_id',
      'far_project.name as project_name',
      'far.title',
      'far_column.is_done',
      eb
        .exists(
          eb
            .selectFrom('project')
            .select('project.id')
            .whereRef('project.id', '=', 'far.project_id')
            .where(accessibleProjectsFilter(userId))
        )
        .as('readable'),
    ])
    .where(`task_dependency.${near}`, '=', taskId)
    .whereRef('far.project_id', '<>', 'near.project_id')
    .where('far.archived_at', 'is', null)
    .orderBy('far_project.name')
    .orderBy('far.title')
    .orderBy('far.id')
    .execute();

  return {
    visible: rows
      .filter((row) => row.readable)
      .map((row) => ({
        task_id: row.task_id,
        project_id: row.project_id,
        project_name: row.project_name,
        title: row.title,
        is_done: row.is_done,
      })),
    hiddenOpen: rows.filter((row) => !row.readable && !row.is_done).length,
  };
}

export async function getCrossProjectDependencies(
  db: Kysely<DB>,
  userId: string,
  taskId: string
): Promise<CrossProjectDependenciesResponse> {
  const blockedBy = await readEdges(db, userId, taskId, 'blocked_by');
  const blocking = await readEdges(db, userId, taskId, 'blocking');
  return {
    blocked_by: blockedBy.visible,
    blocking: blocking.visible,
    hidden_blocked_by_count: blockedBy.hiddenOpen,
    hidden_blocking_count: blocking.hiddenOpen,
  };
}

// What every site that changes a task's done state, archive state or existence
// calls. Named for the blockers whose state moved, not for the tasks that have
// to be recounted.
export async function syncCrossProjectBlockers(
  c: Pick<PublicContext, 'get'>,
  db: Kysely<DB>,
  scope: CrossProjectBlockerScope
): Promise<void> {
  const dependents = await crossProjectDependentsOf(db, scope);
  if (dependents.length === 0) {
    return;
  }
  publishCrossProjectBlockerCounts(
    c,
    await refreshCrossProjectBlockerCounts(
      db,
      dependents.map((dependent) => dependent.task_id)
    )
  );
}
