import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task_series').dropConstraint('task_series_column_id_fkey').execute();

  // Reuses board_column_project_id_id_unique from 0028. column_id is nullable
  // and the default MATCH SIMPLE skips the check whenever it is null, which is
  // what leaves a column-less series alone. The column list on SET NULL is
  // required: without it the action would null project_id too, and project_id
  // is NOT NULL.
  await sql`
    alter table task_series
      add constraint task_series_project_id_column_id_fkey
      foreign key (project_id, column_id)
      references board_column (project_id, id)
      on delete set null (column_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task_series')
    .dropConstraint('task_series_project_id_column_id_fkey')
    .execute();

  await db.schema
    .alterTable('task_series')
    .addForeignKeyConstraint('task_series_column_id_fkey', ['column_id'], 'board_column', ['id'])
    .onDelete('set null')
    .execute();
}
