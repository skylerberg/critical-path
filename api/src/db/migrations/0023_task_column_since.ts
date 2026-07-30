import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task')
    .addColumn('column_since', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  // Existing rows pick up `now()` from the default on add; created_at is the
  // only defensible backfill since past column moves were never recorded.
  await sql`update task set column_since = created_at`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').dropColumn('column_since').execute();
}
