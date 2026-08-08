import type { Kysely } from 'kysely';

// Denormalised because the board read must not join to another project to learn
// whether a remote blocker is done. No backfill: an edge could not cross a
// project before this release, so every existing row's correct value is 0.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task')
    .addColumn('open_cross_project_blocker_count', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').dropColumn('open_cross_project_blocker_count').execute();
}
