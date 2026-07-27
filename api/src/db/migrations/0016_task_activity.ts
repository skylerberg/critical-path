import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('task_activity')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    // created_at is transaction start time, so every entry one request writes
    // shares it; the sequence is what keeps their order stable on read.
    .addColumn('seq', 'bigserial', (col) => col.notNull())
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('actor_user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('old_value', 'jsonb')
    .addColumn('new_value', 'jsonb')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('task_activity_task_id_created_at_seq_idx')
    .on('task_activity')
    .columns(['task_id', 'created_at', 'seq'])
    .execute();

  await db.schema
    .createIndex('task_activity_actor_user_id_idx')
    .on('task_activity')
    .column('actor_user_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('task_activity').execute();
}
