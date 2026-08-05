import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

// Imported straight from the library rather than through src/services/sortKey:
// the migrator dynamic-imports this file outside the bundler, and a migration
// must keep producing the same keys however the service is later refactored.
const keysBetween = (count: number): string[] =>
  generateNKeysBetween(null, null, count, BASE_62_DIGITS);

// Ordering moves from float8 `position` to a fractional index. The column is
// `collate "C"` because the database's en_US.UTF-8 collation does not compare
// ASCII byte-wise, and every client sorts these keys with plain string
// comparison -- under the default collation the two disagree.
interface Scope {
  table: string;
  group: string;
  tiebreak: string;
  identity: readonly string[];
  index: string;
}

const SCOPES: readonly Scope[] = [
  {
    table: 'task',
    group: 'column_id',
    tiebreak: 'id',
    identity: ['id'],
    index: 'task_column_id_sort_key_idx',
  },
  {
    table: 'board_column',
    group: 'project_id',
    tiebreak: 'id',
    identity: ['id'],
    index: 'board_column_project_id_sort_key_idx',
  },
  {
    table: 'checklist_item',
    group: 'task_id',
    tiebreak: 'id',
    identity: ['id'],
    index: 'checklist_item_task_id_sort_key_idx',
  },
  {
    table: 'project_user_position',
    group: 'user_id',
    tiebreak: 'project_id',
    identity: ['user_id', 'project_id'],
    index: 'project_user_position_user_id_sort_key_idx',
  },
  {
    table: 'task_series_checklist_item',
    group: 'series_id',
    tiebreak: 'id',
    identity: ['id'],
    index: 'task_series_checklist_item_series_id_sort_key_idx',
  },
];

const BACKFILL_CHUNK = 500;

async function backfill(db: Kysely<unknown>, scope: Scope): Promise<void> {
  const columns = [scope.group, ...scope.identity].map((column) => sql.ref(column));
  const rows = await sql<Record<string, string>>`
    select ${sql.join(columns)}
    from ${sql.ref(scope.table)}
    order by ${sql.ref(scope.group)}, position, ${sql.ref(scope.tiebreak)}
  `.execute(db);

  const grouped = new Map<string, Record<string, string>[]>();
  for (const row of rows.rows) {
    const group = row[scope.group]!;
    const bucket = grouped.get(group);
    if (bucket) bucket.push(row);
    else grouped.set(group, [row]);
  }

  const updates: { identity: string[]; key: string }[] = [];
  for (const bucket of grouped.values()) {
    const keys = keysBetween(bucket.length);
    bucket.forEach((row, index) => {
      updates.push({ identity: scope.identity.map((column) => row[column]!), key: keys[index]! });
    });
  }

  for (let start = 0; start < updates.length; start += BACKFILL_CHUNK) {
    const chunk = updates.slice(start, start + BACKFILL_CHUNK);
    const values = chunk.map(
      (update) =>
        sql`(${sql.join([
          ...update.identity.map((value) => sql`${value}::uuid`),
          sql`${update.key}::text`,
        ])})`
    );
    const match = scope.identity.map(
      (column) => sql`${sql.ref(`${scope.table}.${column}`)} = ${sql.ref(`v.${column}`)}`
    );
    await sql`
      update ${sql.ref(scope.table)}
      set sort_key = v.sort_key
      from (values ${sql.join(values)}) as v(${sql.join(
        [...scope.identity, 'sort_key'].map((column) => sql.ref(column))
      )})
      where ${sql.join(match, sql` and `)}
    `.execute(db);
  }
}

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const scope of SCOPES) {
    await sql`alter table ${sql.ref(scope.table)} add column sort_key text collate "C"`.execute(db);
    await backfill(db, scope);
    await sql`
      create index ${sql.ref(scope.index)}
      on ${sql.ref(scope.table)} (${sql.ref(scope.group)}, sort_key, ${sql.ref(scope.tiebreak)})
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const scope of SCOPES) {
    await sql`drop index if exists ${sql.ref(scope.index)}`.execute(db);
    await sql`alter table ${sql.ref(scope.table)} drop column sort_key`.execute(db);
  }
}
