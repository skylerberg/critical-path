import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('checklist_item')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('checked', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('position', 'double precision', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('checklist_item_text_not_empty', sql`char_length(text) > 0`)
    .execute();

  await db.schema
    .createIndex('checklist_item_task_id_position_idx')
    .on('checklist_item')
    .columns(['task_id', 'position', 'id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('checklist_item').execute();
}
