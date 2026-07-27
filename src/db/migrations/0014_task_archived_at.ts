import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').addColumn('archived_at', 'timestamptz').execute();

  await db.schema
    .createIndex('task_project_id_archived_at_idx')
    .on('task')
    .columns(['project_id', 'archived_at'])
    .where('archived_at', 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('task_project_id_archived_at_idx').execute();
  await db.schema.alterTable('task').dropColumn('archived_at').execute();
}
