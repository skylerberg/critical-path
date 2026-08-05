import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function quotaExceeded(used: number, quota: number): AppError {
  return new AppError(
    413,
    `This project has used ${megabytes(used)} MB of its ${megabytes(quota)} MB storage quota. ` +
      'Delete an attachment or an image to free space.'
  );
}

// One table, one sum. Images are rows here too, so the quota still covers them
// and a PNG cannot be used to slip past it — it just no longer takes a second
// query and a reconciliation to say so.
async function usedBytes(db: Kysely<DB>, projectId: string): Promise<number> {
  const row = await db
    .selectFrom('task_attachment')
    .innerJoin('task', 'task.id', 'task_attachment.task_id')
    .select((eb) =>
      eb.fn.coalesce(eb.fn.sum<string>('task_attachment.size_bytes'), sql<string>`0`).as('total')
    )
    .where('task.project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

export interface ProjectStorageAllowance {
  used: number;
  quota: number;
  remaining: number;
  exceeded: () => AppError;
}

// Deliberately unlocked: holding the lock across a transfer would serialise a
// project's uploads for its whole duration. The locked check below is what the
// row commit still depends on.
export async function projectStorageAllowance(
  db: Kysely<DB>,
  projectId: string
): Promise<ProjectStorageAllowance> {
  const used = await usedBytes(db, projectId);
  const quota = env.projectStorageQuotaBytes;
  return {
    used,
    quota,
    remaining: Math.max(0, quota - used),
    exceeded: () => quotaExceeded(used, quota),
  };
}

export async function assertProjectStorageQuota(
  db: Kysely<DB>,
  projectId: string,
  addedBytes: number
): Promise<void> {
  // Under READ COMMITTED two concurrent uploads both read the pre-insert total
  // and both commit, overshooting the quota. The salt differs from every other
  // advisory lock here so an upload never serialises against an unrelated write.
  await sql`select pg_advisory_xact_lock(hashtextextended(${projectId}::text, 1))`.execute(db);

  const used = await usedBytes(db, projectId);
  const quota = env.projectStorageQuotaBytes;

  if (used + addedBytes > quota) {
    throw quotaExceeded(used, quota);
  }
}
