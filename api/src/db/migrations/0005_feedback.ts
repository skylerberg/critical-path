import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('feedback')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('message', 'text', (col) => col.notNull())
    .addColumn('page_path', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('feedback_message_not_empty', sql`char_length(message) > 0`)
    .execute();

  await db.schema.createIndex('feedback_user_id_idx').on('feedback').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('feedback').execute();
}
