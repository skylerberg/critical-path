import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ADD COLUMN takes ACCESS EXCLUSIVE; fail fast rather than block live
  // requests. src/db/migrate.ts owns the lock policy.
  await sql`set local lock_timeout = '3s'`.execute(db);

  await db.schema.alterTable('project').addColumn('color', 'text').execute();

  await db.schema
    .alterTable('project')
    .addCheckConstraint(
      'project_color_valid',
      sql`color is null or color in ('rose', 'amber', 'lime', 'emerald', 'sky', 'violet', 'fuchsia', 'slate')`
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('project').dropConstraint('project_color_valid').execute();
  await db.schema.alterTable('project').dropColumn('color').execute();
}
