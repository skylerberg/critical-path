import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function sumOf(
  db: Kysely<DB>,
  table: 'task_attachment' | 'task_image',
  projectId: string
): Promise<number> {
  const row = await db
    .selectFrom(table)
    .innerJoin('task', 'task.id', `${table}.task_id`)
    .select((eb) =>
      eb.fn.coalesce(eb.fn.sum<string>(`${table}.size_bytes`), sql<string>`0`).as('total')
    )
    .where('task.project_id', '=', projectId)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

function quotaExceeded(used: number, quota: number): AppError {
  return new AppError(
    413,
    `This project has used ${megabytes(used)} MB of its ${megabytes(quota)} MB storage quota. ` +
      'Delete an attachment or an image to free space.'
  );
}

// Image bytes count too, or the quota is bypassed by uploading PNGs.
async function usedBytes(db: Kysely<DB>, projectId: string): Promise<number> {
  const [attachmentBytes, imageBytes] = await Promise.all([
    sumOf(db, 'task_attachment', projectId),
    sumOf(db, 'task_image', projectId),
  ]);
  return attachmentBytes + imageBytes;
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
