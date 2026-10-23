import { sql, type Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { AdvisoryLock, takeAdvisoryLock } from '../advisoryLock';

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

// One table, one sum: images are rows here too, so a PNG cannot slip past the
// quota and saying so costs no second query.
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

// Deliberately unlocked: this only reports where the project stands, and holding
// the lock across a transfer would serialize its uploads for the whole duration.
// `assertProjectStorageQuota` is the locked check the row commit depends on.
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
  // Under READ COMMITTED two concurrent uploads would both read the pre-insert
  // total and both commit, overshooting the quota.
  await takeAdvisoryLock(db, AdvisoryLock.projectStorageQuota, projectId);

  const used = await usedBytes(db, projectId);
  const quota = env.projectStorageQuotaBytes;

  if (used + addedBytes > quota) {
    throw quotaExceeded(used, quota);
  }
}
