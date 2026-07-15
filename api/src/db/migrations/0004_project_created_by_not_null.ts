import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('project')
    .alterColumn('created_by', (col) => col.setNotNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('project')
    .alterColumn('created_by', (col) => col.dropNotNull())
    .execute();
}
