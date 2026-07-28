import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Every pending migration shares one transaction, so ADD COLUMN's ACCESS
  // EXCLUSIVE lock blocks reads of project_member until commit; fail fast instead.
  await sql`set local lock_timeout = '3s'`.execute(db);

  await db.schema
    .alterTable('project_member')
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('editor'))
    .execute();

  await db.schema
    .alterTable('project_member')
    .addCheckConstraint('project_member_role_valid', sql`role in ('editor', 'viewer')`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('project_member')
    .dropConstraint('project_member_role_valid')
    .execute();
  await db.schema.alterTable('project_member').dropColumn('role').execute();
}
