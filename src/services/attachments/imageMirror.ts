import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';

// Transitional: images are still owned by task_image and every read comes from
// it, but each write is mirrored into task_attachment as kind='image' so the two
// tables converge while old and new pods run side by side. The release that
// moves reads across deletes this module and its call sites; the one after that
// drops task_image.
export interface MirroredImage {
  id: string;
  task_id: string;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  is_cover: boolean;
  created_at: Date;
}

export async function mirrorImagesInserted(db: Kysely<DB>, images: MirroredImage[]): Promise<void> {
  if (images.length === 0) {
    return;
  }
  await db
    .insertInto('task_attachment')
    .values(
      images.map((image) => ({
        id: image.id,
        task_id: image.task_id,
        kind: 'image',
        filename: image.filename,
        size_bytes: image.size_bytes,
        image_storage_key: image.storage_key,
        image_content_type: image.content_type,
        is_cover: image.is_cover,
        created_at: image.created_at,
        updated_at: image.created_at,
      }))
    )
    // The id is the image's own, so a row already backfilled by the migration is
    // the same row and not a conflict worth failing an upload over.
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();
}

export async function mirrorImageDeleted(db: Kysely<DB>, imageId: string): Promise<void> {
  await db
    .deleteFrom('task_attachment')
    .where('task_attachment.id', '=', imageId)
    .where('task_attachment.kind', '=', 'image')
    .execute();
}

// Mirrors the clear-then-set the cover route runs, in the same order and for the
// same reason: a single `is_cover = (id = $imageId)` update trips the partial
// unique index as it walks the rows.
export async function mirrorCoverSet(
  db: Kysely<DB>,
  taskId: string,
  imageId: string | null
): Promise<void> {
  await db
    .updateTable('task_attachment')
    .set({ is_cover: false })
    .where('task_attachment.task_id', '=', taskId)
    .where('task_attachment.kind', '=', 'image')
    .where('task_attachment.is_cover', '=', true)
    .execute();

  if (imageId !== null) {
    await db
      .updateTable('task_attachment')
      .set({ is_cover: true })
      .where('task_attachment.id', '=', imageId)
      .where('task_attachment.kind', '=', 'image')
      .execute();
  }
}
