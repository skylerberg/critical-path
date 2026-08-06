import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// Every scope's ordering now lives entirely in `sort_key`, so the column stops
// being nullable and starts being unique. The `task` index deliberately spans
// archived rows: an archived card holds its slot, which is what stops a live
// one from being appended onto it and what makes restoring a card land where it
// left rather than in uuid order.
const SCOPES = [
  { table: 'task', group: 'column_id', index: 'task_column_id_sort_key_key' },
  { table: 'board_column', group: 'project_id', index: 'board_column_project_id_sort_key_key' },
  { table: 'checklist_item', group: 'task_id', index: 'checklist_item_task_id_sort_key_key' },
  {
    table: 'project_user_position',
    group: 'user_id',
    index: 'project_user_position_user_id_sort_key_key',
  },
  {
    table: 'task_series_checklist_item',
    group: 'series_id',
    index: 'task_series_checklist_item_series_id_sort_key_key',
  },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const scope of SCOPES) {
    await sql`alter table ${sql.ref(scope.table)} alter column sort_key set not null`.execute(db);
    await sql`
      create unique index ${sql.ref(scope.index)}
      on ${sql.ref(scope.table)} (${sql.ref(scope.group)}, sort_key)
    `.execute(db);
    await sql`alter table ${sql.ref(scope.table)} drop column position`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const scope of SCOPES) {
    // Positions cannot be recovered, so they come back evenly spaced in the
    // order the keys already describe.
    await sql`alter table ${sql.ref(scope.table)} add column position double precision`.execute(db);
    await sql`
      update ${sql.ref(scope.table)} as t
      set position = ranked.rank * 1000
      from (
        select ctid, row_number() over (partition by ${sql.ref(scope.group)} order by sort_key) as rank
        from ${sql.ref(scope.table)}
      ) as ranked
      where t.ctid = ranked.ctid
    `.execute(db);
    await sql`alter table ${sql.ref(scope.table)} alter column position set not null`.execute(db);
    await sql`drop index if exists ${sql.ref(scope.index)}`.execute(db);
    await sql`alter table ${sql.ref(scope.table)} alter column sort_key drop not null`.execute(db);
  }
}
