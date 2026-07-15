import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';

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
