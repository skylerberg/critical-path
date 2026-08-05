import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { keyBetween, keysBetween } from './sortKey';

// Re-derives a scope's keys from its `position` order. Callers run it inline
// rather than at commit, because a handler that reads its own write back --
// project creation returning a board payload, say -- orders that read by
// sort_key and would otherwise see the row's key missing.
interface ScopeShape {
  group: string;
  tiebreak: string;
  identity: readonly string[];
}

const SCOPES = {
  task: { group: 'column_id', tiebreak: 'id', identity: ['id'] },
  board_column: { group: 'project_id', tiebreak: 'id', identity: ['id'] },
  checklist_item: { group: 'task_id', tiebreak: 'id', identity: ['id'] },
  project_user_position: {
    group: 'user_id',
    tiebreak: 'project_id',
    identity: ['user_id', 'project_id'],
  },
  task_series_checklist_item: { group: 'series_id', tiebreak: 'id', identity: ['id'] },
} as const satisfies Record<string, ScopeShape>;

export type SortKeyTable = keyof typeof SCOPES;

// Rows already in increasing key order keep their keys, so moving one card
// re-keys one row rather than the column: a greedy left-to-right scan would
// rewrite every row whenever something lands at the top.
function keepLongestIncreasing(keys: readonly (string | null)[]): boolean[] {
  const tails: number[] = [];
  const previous = new Array<number>(keys.length).fill(-1);

  for (let index = 0; index < keys.length; index++) {
    const key = keys[index];
    if (key === null) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (keys[tails[middle]!]! < key) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = index;
  }

  const kept = new Array<boolean>(keys.length).fill(false);
  let cursor = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (cursor !== -1) {
    kept[cursor] = true;
    cursor = previous[cursor]!;
  }
  return kept;
}

// Request paths mark scopes and the transaction middleware drains them once
// before commit; the series worker has no request to hang that on and calls
// this directly.
export async function reconcileSortKeys(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string
): Promise<void> {
  const scope: ScopeShape = SCOPES[table];
  const columns = [...scope.identity, 'sort_key'].map((column) => sql.ref(column));
  const { rows } = await sql<Record<string, string | null>>`
    select ${sql.join(columns)}
    from ${sql.ref(table)}
    where ${sql.ref(scope.group)} = ${group}
    order by position, ${sql.ref(scope.tiebreak)}
  `.execute(db);
  if (rows.length === 0) return;

  const keys = rows.map((row) => row.sort_key);
  const kept = keepLongestIncreasing(keys);
  const updates: { identity: string[]; key: string }[] = [];

  for (let start = 0; start < rows.length; ) {
    if (kept[start]) {
      start++;
      continue;
    }
    let end = start;
    while (end < rows.length && !kept[end]) end++;
    const lower = start > 0 ? keys[start - 1]! : null;
    const upper = end < rows.length ? keys[end]! : null;
    const fresh = keysBetween(lower, upper, end - start);
    for (let offset = 0; offset < fresh.length; offset++) {
      const row = rows[start + offset]!;
      updates.push({
        identity: scope.identity.map((column) => row[column]!),
        key: fresh[offset]!,
      });
    }
    start = end;
  }

  if (updates.length === 0) return;

  const values = updates.map(
    (update) =>
      sql`(${sql.join([
        ...update.identity.map((value) => sql`${value}::uuid`),
        sql`${update.key}::text`,
      ])})`
  );
  const match = scope.identity.map(
    (column) => sql`${sql.ref(`${table}.${column}`)} = ${sql.ref(`v.${column}`)}`
  );
  await sql`
    update ${sql.ref(table)}
    set sort_key = v.sort_key
    from (values ${sql.join(values)}) as v(${sql.join(
      [...scope.identity, 'sort_key'].map((column) => sql.ref(column))
    )})
    where ${sql.join(match, sql` and `)}
  `.execute(db);
}

// The row is not in the table yet, so the neighbours are found by the same
// (position, tiebreak) comparison the reads order by. Deriving before the write
// keeps the inserted row's own response honest -- reconciling afterwards would
// leave whatever the insert returned holding a stale key.
export async function sortKeyForPosition(
  db: Kysely<DB>,
  table: SortKeyTable,
  group: string,
  position: number,
  tiebreak: string
): Promise<string> {
  const scope: ScopeShape = SCOPES[table];
  const neighbour = async (direction: 'before' | 'after'): Promise<string | null> => {
    const { rows } = await sql<{ sort_key: string }>`
      select sort_key from ${sql.ref(table)}
      where ${sql.ref(scope.group)} = ${group}
        and sort_key is not null
        and (position, ${sql.ref(scope.tiebreak)}) ${direction === 'before' ? sql`<` : sql`>`} (${position}, ${tiebreak})
      order by position ${direction === 'before' ? sql`desc` : sql`asc`},
        ${sql.ref(scope.tiebreak)} ${direction === 'before' ? sql`desc` : sql`asc`}
      limit 1
    `.execute(db);
    return rows[0]?.sort_key ?? null;
  };
  return keyBetween(await neighbour('before'), await neighbour('after'));
}
