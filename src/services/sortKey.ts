import { sql, type Kysely } from 'kysely';
import type { DB, ResolvedSortKey } from '../db/types';
import { generateKeyBetween, generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

// The only place a plain string becomes writable. Everything below hands back
// a key it has just ranked against the whole scope -- archived rows included --
// so the assertion is the claim that it did, not a way around the check.
function resolved(key: string): ResolvedSortKey {
  return key as ResolvedSortKey;
}

// Inserting repeatedly against the same neighbor lengthens each successive key
// by ~0.2 characters, so the cap is what bounds insertions at a single spot
// (~5000). Reaching it is a clean rejection, never a silent reordering, and it
// stays clear of both Postgres' btree entry limit and the recursion depth in
// the library's midpoint().
export const SORT_KEY_MAX_LENGTH = 1024;

export function keyBetween(a: string | null, b: string | null): ResolvedSortKey {
  return resolved(generateKeyBetween(a, b, BASE_62_DIGITS));
}

export function keysBetween(a: string | null, b: string | null, count: number): ResolvedSortKey[] {
  return generateNKeysBetween(a, b, count, BASE_62_DIGITS).map(resolved);
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

async function maxKey(db: Kysely<DB>, table: SortKeyTable, group: string): Promise<string | null> {
  const { rows } = await sql<{ max: string | null }>`
    select max(sort_key) as max from ${sql.ref(table)}
    where ${sql.ref(SCOPES[table])} = ${group}
  `.execute(db);
  return rows[0]?.max ?? null;
}

// The two keys at or above the requested one: whether it is taken, and what
// bounds it if it is.
async function keysAtOrAbove(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string,
  requested: string
): Promise<string[]> {
  const { rows } = await sql<{ sort_key: string }>`
    select sort_key from ${sql.ref(table)}
    where ${sql.ref(SCOPES[table])} = ${group} and sort_key >= ${requested}
    order by sort_key
    limit 2
  `.execute(db);
  return rows.map((row) => row.sort_key);
}

function rankAt(requested: string, atOrAbove: readonly string[]): ResolvedSortKey {
  const ordered = [...new Set(atOrAbove)].sort();
  if (ordered[0] !== requested) {
    return resolved(requested);
  }
  // Taken: rank immediately after it, bounded by whatever sits above.
  return keysBetween(requested, ordered[1] ?? null, 1)[0]!;
}

// The default rank for a row created without one: the end of its scope. The
// probe spans archived rows too, so an appended card never lands on the key an
// archived one is still holding.
export async function appendKeys(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string,
  count = 1
): Promise<ResolvedSortKey[]> {
  return keysBetween(await maxKey(db, table, group), null, count);
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
): Promise<ResolvedSortKey> {
  return rankAt(requested, await keysAtOrAbove(db, table, group, requested));
}

// One insert's worth of keys, resolved against each other as well as against the
// scope: the rows earlier in the run are not in the table yet, so resolving each
// one alone would hand the same free slot to two of them. An undefined entry
// appends, after both the scope's tail and everything the run has claimed.
export async function resolveSortKeys(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string,
  requested: readonly (string | undefined)[]
): Promise<ResolvedSortKey[]> {
  const keys = new Array<ResolvedSortKey | undefined>(requested.length);
  const claimed: ResolvedSortKey[] = [];

  for (const [index, key] of requested.entries()) {
    if (key === undefined) {
      continue;
    }
    const scope = await keysAtOrAbove(db, table, group, key);
    const ranked = rankAt(key, [...scope, ...claimed.filter((taken) => taken >= key)]);
    keys[index] = ranked;
    claimed.push(ranked);
  }

  const appending = [...requested.keys()].filter((index) => requested[index] === undefined);
  if (appending.length > 0) {
    const tail = [await maxKey(db, table, group), ...claimed]
      .filter((key): key is string => key !== null)
      .sort()
      .at(-1);
    const fresh = keysBetween(tail ?? null, null, appending.length);
    appending.forEach((index, position) => {
      keys[index] = fresh[position]!;
    });
  }

  return keys as ResolvedSortKey[];
}
