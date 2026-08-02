import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Every pending migration shares one transaction, so ADD COLUMN's ACCESS
  // EXCLUSIVE lock blocks every authenticated request until commit; fail fast
  // instead.
  await sql`set local lock_timeout = '3s'`.execute(db);

  await db.schema.alterTable('session').addColumn('user_agent', 'text').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('session').dropColumn('user_agent').execute();
}
