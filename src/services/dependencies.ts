import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import type { CycleTask } from '../schemas/index';
import { AdvisoryLock, takeAdvisoryLock } from './advisoryLock';
import { accessibleProjectsFilter } from './authorization';

// Serializes concurrent dependency writes within a project; without it two
// transactions could each pass the cycle check and commit a cycle under
// READ COMMITTED. Must run inside the request transaction.
export async function lockProjectDependencies(db: Kysely<DB>, projectId: string): Promise<void> {
  await takeAdvisoryLock(db, AdvisoryLock.projectDependencies, projectId);
}

// A cross-project edge has to serialize against writers in both projects, and
// ascending id is the order every such writer uses: two edges created in
// opposite directions between the same pair would deadlock on any other rule.
// Same reasoning as inProjectLockOrder, one lock lower down.
export async function lockDependencyProjects(
  db: Kysely<DB>,
  projectIds: readonly string[]
): Promise<void> {
  for (const projectId of [...new Set(projectIds)].sort()) {
    await lockProjectDependencies(db, projectId);
  }
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

// The edges reachable downstream of the blocked task, which is exactly the set
// cyclePathIds' BFS explores. Scoped by reachability rather than by project: a
// loop that leaves the project and comes back is invisible to a project filter,
// and fetching the whole table to find it would be worse. UNION, not UNION ALL,
// so it terminates on data that already contains a cycle.
async function downstreamEdges(db: Kysely<DB>, blockedTaskId: string) {
  const result = await sql<DependencyEdge>`
    with recursive downstream(blocker_task_id, blocked_task_id) as (
      select d.blocker_task_id, d.blocked_task_id
      from task_dependency d
      where d.blocker_task_id = ${blockedTaskId}::uuid
      union
      select d.blocker_task_id, d.blocked_task_id
      from task_dependency d
      join downstream on d.blocker_task_id = downstream.blocked_task_id
    )
    select blocker_task_id, blocked_task_id from downstream
  `.execute(db);
  return result.rows;
}

export async function findDependencyCyclePath(
  db: Kysely<DB>,
  actorUserId: string,
  blockedTaskId: string,
  blockerTaskId: string
): Promise<CycleTask[]> {
  const edges = await downstreamEdges(db, blockedTaskId);

  const path = cyclePathIds(edges, blockedTaskId, blockerTaskId);
  if (path.length === 0) {
    return [];
  }

  const rows = await db
    .selectFrom('task')
    .innerJoin('project', 'project.id', 'task.project_id')
    .select(['task.id', 'task.title'])
    .where('task.id', 'in', [...new Set(path)])
    .where(accessibleProjectsFilter(actorUserId))
    .execute();
  const titles = new Map(rows.map((row) => [row.id, row.title]));

  const steps: CycleTask[] = [];
  for (const id of path) {
    const title = titles.get(id);
    // Absent means either concurrently deleted or in a project the caller
    // cannot read. Both are reported the same way: the loop keeps its length
    // and shape, so it still reads as a closed loop, but the hidden hops name
    // nothing at all.
    steps.push(title === undefined ? { id: null, title: null } : { id, title });
  }
  return steps;
}
