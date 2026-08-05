import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// Images move into task_attachment as a third kind. They keep their own storage
// and content-type columns rather than sharing the file ones, so
// GET /api/images/:id can select those two columns and remain structurally
// unable to reach a document's bytes — the same reason preview_storage_key and
// favicon_storage_key are separate.
//
// Row ids are preserved verbatim: /api/images/<uuid> is baked into every task
// description and comment body, so a new id space would mean rewriting user
// content. storage_key is cast to uuid because both writers that ever produced
// one (the upload route and project copy) use crypto.randomUUID().
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('task_attachment')
    .addColumn('image_storage_key', 'uuid')
    .addColumn('image_content_type', 'text')
    .addColumn('is_cover', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_kind_valid')
    .execute();
  await db.schema
    .alterTable('task_attachment')
    .addCheckConstraint('task_attachment_kind_valid', sql`kind in ('file', 'link', 'image')`)
    .execute();

  // Both existing shapes gain "and no image columns", so a file or link can
  // never carry bytes the image route would serve.
  await db.schema
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_file_shape')
    .execute();
  await db.schema
    .alterTable('task_attachment')
    .addCheckConstraint(
      'task_attachment_file_shape',
      sql`kind <> 'file' or (
            storage_key is not null and filename is not null and char_length(filename) > 0
            and content_type is not null and size_bytes is not null and size_bytes >= 0
            and url is null and unfurl_state is null
            and preview_storage_key is null and favicon_storage_key is null
            and image_storage_key is null and image_content_type is null
            and is_cover = false)`
    )
    .execute();

  await db.schema
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_link_shape')
    .execute();
  await db.schema
    .alterTable('task_attachment')
    .addCheckConstraint(
      'task_attachment_link_shape',
      sql`kind <> 'link' or (
            url is not null and char_length(url) > 0
            and unfurl_state in ('pending', 'ok', 'failed')
            and storage_key is null and filename is null
            and content_type is null and size_bytes is null
            and image_storage_key is null and image_content_type is null
            and is_cover = false)`
    )
    .execute();

  // The content type is pinned to what magic-byte sniffing can produce, so no
  // repair query or importer can leave a row the image route would serve as
  // something renderable-but-hostile.
  await db.schema
    .alterTable('task_attachment')
    .addCheckConstraint(
      'task_attachment_image_shape',
      sql`kind <> 'image' or (
            image_storage_key is not null
            and image_content_type in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
            and filename is not null and char_length(filename) > 0
            and size_bytes is not null and size_bytes >= 0
            and storage_key is null and content_type is null
            and url is null and unfurl_state is null
            and preview_storage_key is null and favicon_storage_key is null)`
    )
    .execute();

  await sql`
    create unique index task_attachment_cover_idx
      on task_attachment (task_id)
      where is_cover and kind = 'image'
  `.execute(db);

  await sql`
    insert into task_attachment (
      id, task_id, kind, filename, size_bytes,
      image_storage_key, image_content_type, is_cover, created_at, updated_at
    )
    select
      id, task_id, 'image', filename, size_bytes,
      storage_key::uuid, content_type, is_cover, created_at, created_at
    from task_image
    on conflict (id) do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`delete from task_attachment where kind = 'image'`.execute(db);
  await sql`drop index if exists task_attachment_cover_idx`.execute(db);

  await db.schema
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_image_shape')
    .execute();

  await db.schema
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_link_shape')
    .execute();
  await db.schema
    .alterTable('task_attachment')
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
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_file_shape')
    .execute();
  await db.schema
    .alterTable('task_attachment')
    .addCheckConstraint(
      'task_attachment_file_shape',
      sql`kind <> 'file' or (
            storage_key is not null and filename is not null and char_length(filename) > 0
            and content_type is not null and size_bytes is not null and size_bytes >= 0
            and url is null and unfurl_state is null
            and preview_storage_key is null and favicon_storage_key is null)`
    )
    .execute();

  await db.schema
    .alterTable('task_attachment')
    .dropConstraint('task_attachment_kind_valid')
    .execute();
  await db.schema
    .alterTable('task_attachment')
    .addCheckConstraint('task_attachment_kind_valid', sql`kind in ('file', 'link')`)
    .execute();

  await db.schema
    .alterTable('task_attachment')
    .dropColumn('image_storage_key')
    .dropColumn('image_content_type')
    .dropColumn('is_cover')
    .execute();
}
