import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('task_attachment')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('title', 'text')
    .addColumn('description', 'text')
    .addColumn('filename', 'text')
    .addColumn('content_type', 'text')
    .addColumn('size_bytes', 'integer')
    .addColumn('storage_key', 'uuid')
    .addColumn('url', 'text')
    .addColumn('preview_storage_key', 'uuid')
    .addColumn('favicon_storage_key', 'uuid')
    .addColumn('unfurl_state', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('task_attachment_kind_valid', sql`kind in ('file', 'link')`)
    // Shape, not length: no repair query, importer or future copy routine can
    // leave a row whose kind promises a column it did not fill in.
    .addCheckConstraint(
      'task_attachment_file_shape',
      sql`kind <> 'file' or (
            storage_key is not null and filename is not null and char_length(filename) > 0
            and content_type is not null and size_bytes is not null and size_bytes >= 0
            and url is null and unfurl_state is null
            and preview_storage_key is null and favicon_storage_key is null)`
    )
    .addCheckConstraint(
      'task_attachment_link_shape',
      sql`kind <> 'link' or (
            url is not null and char_length(url) > 0
            and unfurl_state in ('pending', 'ok', 'failed')
            and storage_key is null and filename is null
            and content_type is null and size_bytes is null)`
    )
    .execute();

  await db.schema
    .createIndex('task_attachment_task_id_idx')
    .on('task_attachment')
    .columns(['task_id', 'created_at', 'id'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('task_attachment').execute();
}
