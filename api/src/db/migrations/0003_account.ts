import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('app_user')
    .addColumn('alternative_id', 'uuid', (col) =>
      col
        .notNull()
        .defaultTo(sql`gen_random_uuid()`)
        .unique()
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('app_user').dropColumn('alternative_id').execute();
}
