import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // ADD COLUMN takes ACCESS EXCLUSIVE; fail fast rather than block live
  // requests. src/db/migrate.ts owns the lock policy.
  await sql`set local lock_timeout = '3s'`.execute(db);

  await db.schema.alterTable('session').addColumn('user_agent', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('session').dropColumn('user_agent').execute();
}
