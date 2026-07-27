import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('personal_access_token')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('personal_access_token_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createIndex('personal_access_token_user_id_idx')
    .on('personal_access_token')
    .column('user_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('personal_access_token').execute();
}
