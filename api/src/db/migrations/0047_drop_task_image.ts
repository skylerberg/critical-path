import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// Last step of folding images into task_attachment. Two releases have gone by
// since anything read this table and one since anything wrote it, so dropping
// it now cannot pull it out from under a pod still serving.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('task_image').execute();
}

// Rebuilds the table as it stood after 0021 and refills it from the image rows
// in task_attachment, which hold every column it had — so rolling back to a
// release that still reads task_image finds its images there rather than an
// empty table.
export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('task_image')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('storage_key', 'text', (col) => col.notNull())
    .addColumn('filename', 'text', (col) => col.notNull())
    .addColumn('content_type', 'text', (col) => col.notNull())
    .addColumn('size_bytes', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('is_cover', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createIndex('task_image_task_id_idx')
    .on('task_image')
    .column('task_id')
    .execute();

  await sql`
    create unique index task_image_cover_idx
      on task_image (task_id)
      where is_cover
  `.execute(db);

  await sql`
    insert into task_image (
      id, task_id, storage_key, filename, content_type, size_bytes, created_at, is_cover
    )
    select
      id, task_id, image_storage_key::text, filename, image_content_type, size_bytes,
      created_at, is_cover
    from task_attachment
    where kind = 'image'
  `.execute(db);
}
