import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').dropConstraint('task_column_id_fkey').execute();

  await db.schema
    .createIndex('board_column_project_id_id_unique')
    .unique()
    .on('board_column')
    .columns(['project_id', 'id'])
    .execute();

  // Both columns are NOT NULL, so this is checked on every row and subsumes the
  // column_id-only key it replaces.
  await db.schema
    .alterTable('task')
    .addForeignKeyConstraint(
      'task_project_id_column_id_fkey',
      ['project_id', 'column_id'],
      'board_column',
      ['project_id', 'id']
    )
    .onDelete('cascade')
    .execute();

  // project_id is a prefix of the index added above.
  await db.schema.dropIndex('board_column_project_id_idx').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').dropConstraint('task_project_id_column_id_fkey').execute();

  await db.schema
    .alterTable('task')
    .addForeignKeyConstraint('task_column_id_fkey', ['column_id'], 'board_column', ['id'])
    .onDelete('cascade')
    .execute();

  await db.schema
    .createIndex('board_column_project_id_idx')
    .on('board_column')
    .column('project_id')
    .execute();

  // Postgres records the unique index as the composite key's target, so it can
  // only be dropped once that key is gone.
  await db.schema.dropIndex('board_column_project_id_id_unique').execute();
}
