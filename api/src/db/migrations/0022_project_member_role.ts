import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
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
