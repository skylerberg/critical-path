import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';

// Every transaction-scoped advisory lock the API takes, and the only place a
// salt is chosen. A salt is what keeps two lock families apart when they hash
// the same id: dependency cycles and the storage quota are both keyed by a
// project, so a shared salt would make an upload wait behind an unrelated
// blocker edge. Column ids get a salt of their own, which makes their distance
// from the project locks structural rather than a consequence of how uuids
// happen to fall.
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

// Held until commit: callers take it after the work that does not need it, and
// before any row lock the same transaction goes on to take.
export async function takeAdvisoryLock(
  db: Kysely<DB>,
  lock: AdvisoryLockName,
  key: string
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, ${lock}::bigint))`.execute(
    db
  );
}
