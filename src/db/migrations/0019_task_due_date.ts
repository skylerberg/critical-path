import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').addColumn('due_date', 'date').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').dropColumn('due_date').execute();
}
