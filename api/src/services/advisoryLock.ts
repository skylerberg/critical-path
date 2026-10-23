import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';

// Every transaction-scoped advisory lock the API takes, and the only place a
// salt is chosen. The salt separates two locks that hash the same id:
// dependency cycles and the storage quota are both keyed by a project, and a
// shared salt would make an upload wait behind an unrelated blocker edge.
// Column ids would not collide with project ids in practice, but their own salt
// makes that a fact about this table rather than about how uuids happen to fall.
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

// Held until the transaction commits, so a caller takes it after the work that
// does not need it and before any row lock it goes on to take.
export async function takeAdvisoryLock(
  db: Kysely<DB>,
  lock: AdvisoryLockName,
  key: string
): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${key}::text, ${lock}::bigint))`.execute(
    db
  );
}
