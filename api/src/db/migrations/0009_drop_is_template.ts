import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('project').dropColumn('is_template').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('project')
    .addColumn('is_template', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();
}
