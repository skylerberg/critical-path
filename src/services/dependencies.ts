import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { CycleTask } from '../schemas/index';

// Serializes concurrent dependency writes within a project; without it two
// transactions could each pass the cycle check and commit a cycle under
// READ COMMITTED. Must run inside the request transaction.
export async function lockProjectDependencies(db: Kysely<DB>, projectId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${projectId}::text, 0))`.execute(db);
}

// UNION (not UNION ALL) deduplicates rows, so the walk terminates even if
// corrupt data already contains a cycle.
export async function wouldCreateDependencyCycle(
  db: Kysely<DB>,
  blockedTaskId: string,
  blockerTaskId: string
): Promise<boolean> {
  const result = await sql`
    with recursive upstream(task_id) as (
      select ${blockerTaskId}::uuid
      union
      select task_dependency.blocker_task_id
      from task_dependency
      join upstream on task_dependency.blocked_task_id = upstream.task_id
    )
    select 1 from upstream where task_id = ${blockedTaskId}::uuid limit 1
  `.execute(db);
  return result.rows.length > 0;
}

export interface DependencyEdge {
  blocker_task_id: string;
  blocked_task_id: string;
}

// blockedTaskId is repeated as the last element: that final hop is the edge the
// caller is about to create, so the result reads as a closed loop.
export function cyclePathIds(
  edges: readonly DependencyEdge[],
  blockedTaskId: string,
  blockerTaskId: string
): string[] {
  const blocks = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = blocks.get(edge.blocker_task_id);
    if (targets) {
      targets.push(edge.blocked_task_id);
    } else {
      blocks.set(edge.blocker_task_id, [edge.blocked_task_id]);
    }
  }

  const predecessors = new Map<string, string>();
  const visited = new Set<string>([blockedTaskId]);
  const queue = [blockedTaskId];

  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const blocked of blocks.get(current) ?? []) {
      if (visited.has(blocked)) continue;
      visited.add(blocked);
      predecessors.set(blocked, current);
      if (blocked !== blockerTaskId) {
        queue.push(blocked);
        continue;
      }
      const path = [blockerTaskId];
      for (let node = current; node !== blockedTaskId; node = predecessors.get(node)!) {
        path.push(node);
      }
      path.push(blockedTaskId);
      path.reverse();
      path.push(blockedTaskId);
      return path;
    }
  }

  return [];
}

export async function findDependencyCyclePath(
  db: Kysely<DB>,
  projectId: string,
  blockedTaskId: string,
  blockerTaskId: string
): Promise<CycleTask[]> {
  const edges = await db
    .selectFrom('task_dependency')
    .innerJoin('task', 'task.id', 'task_dependency.blocked_task_id')
    .select(['task_dependency.blocker_task_id', 'task_dependency.blocked_task_id'])
    .where('task.project_id', '=', projectId)
    .execute();

  const path = cyclePathIds(edges, blockedTaskId, blockerTaskId);
  if (path.length === 0) {
    return [];
  }

  const rows = await db
    .selectFrom('task')
    .select(['task.id', 'task.title'])
    .where('task.id', 'in', [...new Set(path)])
    .execute();
  const titles = new Map(rows.map((row) => [row.id, row.title]));

  const steps: CycleTask[] = [];
  for (const id of path) {
    const title = titles.get(id);
    // READ COMMITTED gives this statement a newer snapshot than the edge fetch,
    // so a concurrently deleted task has no row; report no path rather than a
    // step with a blank name.
    if (title === undefined) {
      return [];
    }
    steps.push({ id, title });
  }
  return steps;
}
