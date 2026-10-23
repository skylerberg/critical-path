import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';

// Every transaction-scoped advisory lock the API takes. The value salts the key
// hash, so two locks keyed by the same id do not collide: dependency cycles and
// the storage quota are both keyed by a project, and sharing a salt would make
// an upload wait behind an unrelated blocker edge.
//
// Values are frozen. Deploys are rolling, so pods on either side of a release
// must agree on a lock's key or they will not exclude each other: give a new
// lock the next unused number, never reuse or renumber.
export const AdvisoryLock = {
  projectDependencies: 0,
  projectStorageQuota: 1,
  columnTail: 2,
} as const;

export type AdvisoryLockName = (typeof AdvisoryLock)[keyof typeof AdvisoryLock];

// Held until commit: take it after the work that does not need it, and before
// any row lock taken afterwards.
export async function takeAdvisoryLock(
  db: Kysely<DB>,
  lock: AdvisoryLockName,
  key: string
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, ${lock}::bigint))`.execute(
    db
  );
}
