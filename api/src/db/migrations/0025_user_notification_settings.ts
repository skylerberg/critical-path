import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Every pending migration shares one transaction, so ADD COLUMN's ACCESS
  // EXCLUSIVE lock blocks reads of app_user until commit; fail fast instead.
  await sql`set local lock_timeout = '3s'`.execute(db);

  await db.schema
    .alterTable('app_user')
    .addColumn('notify_task_assigned', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('notify_added_to_project', 'boolean', (col) => col.notNull().defaultTo(true))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('app_user')
    .dropColumn('notify_task_assigned')
    .dropColumn('notify_added_to_project')
    .execute();
}
