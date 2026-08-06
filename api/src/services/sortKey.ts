import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { generateKeyBetween, generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

// Inserting repeatedly against the same neighbour lengthens each successive key
// by ~0.2 characters, so the cap is what bounds insertions at a single spot
// (~5000). Reaching it is a clean rejection, never a silent reordering, and it
// stays clear of both Postgres' btree entry limit and the recursion depth in
// the library's midpoint().
export const SORT_KEY_MAX_LENGTH = 1024;

export function keyBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b, BASE_62_DIGITS);
}

export function keysBetween(a: string | null, b: string | null, count: number): string[] {
  return generateNKeysBetween(a, b, count, BASE_62_DIGITS);
}

export function isValidSortKey(key: string): boolean {
  if (key.length === 0 || key.length > SORT_KEY_MAX_LENGTH) {
    return false;
  }
  for (const character of key) {
    if (!BASE_62_DIGITS.includes(character)) {
      return false;
    }
  }
  return structurallyValid(key);
}

// The library validates a key whenever it is used as a bound. Either direction
// proves the structure; one alone would also reject the largest and smallest
// representable integers, which are structurally fine but have no room beyond.
function structurallyValid(key: string): boolean {
  for (const bounds of [[key, null] as const, [null, key] as const]) {
    try {
      generateKeyBetween(bounds[0], bounds[1], BASE_62_DIGITS);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// Ordering scopes, and the column that groups each one.
const SCOPES = {
  task: 'column_id',
  board_column: 'project_id',
  checklist_item: 'task_id',
  project_user_position: 'user_id',
  task_series_checklist_item: 'series_id',
} as const;

export type SortKeyTable = keyof typeof SCOPES;

// The default rank for a row created without one: the end of its scope. The
// probe spans archived rows too, so an appended card never lands on the key an
// archived one is still holding.
export async function appendKeys(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string,
  count = 1
): Promise<string[]> {
  const { rows } = await sql<{ max: string | null }>`
    select max(sort_key) as max from ${sql.ref(table)}
    where ${sql.ref(SCOPES[table])} = ${group}
  `.execute(db);
  return keysBetween(rows[0]?.max ?? null, null, count);
}

// A client ranks a card against what it can see, which excludes the archived
// rows still holding keys in that column. Resolving before the write rather than
// retrying after one: every mutation runs in a transaction, and a failed
// statement aborts it, so there is nothing left to retry on.
export async function resolveSortKey(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string,
  requested: string
): Promise<string> {
  const { rows } = await sql<{ sort_key: string }>`
    select sort_key from ${sql.ref(table)}
    where ${sql.ref(SCOPES[table])} = ${group} and sort_key >= ${requested}
    order by sort_key
    limit 2
  `.execute(db);
  if (rows[0]?.sort_key !== requested) {
    return requested;
  }
  // Taken: rank immediately after it, bounded by whatever sits above.
  return keysBetween(requested, rows[1]?.sort_key ?? null, 1)[0]!;
}
