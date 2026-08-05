import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import { MIRRORED_IMAGE_KIND } from './index';

// Every write of a kind='image' row. Images live in task_attachment alongside
// files and links, and carry their own storage and content-type columns so the
// unauthenticated image route can reach them without being able to reach a
// document's bytes.
export interface TaskImageInsert {
  id: string;
  task_id: string;
  storage_key: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  is_cover: boolean;
}

// Returns each new row's created_at, which the DB assigns.
export async function insertTaskImages(
  db: Kysely<DB>,
  images: TaskImageInsert[]
): Promise<Map<string, Date>> {
  if (images.length === 0) {
    return new Map();
  }
  // No onConflict: this insert is the row's only home now, so a client-supplied
  // id that is already taken has to raise and become a 409 rather than silently
  // resolving to somebody else's image.
  const rows = await db
    .insertInto('task_attachment')
    .values(
      images.map((image) => ({
        id: image.id,
        task_id: image.task_id,
        kind: MIRRORED_IMAGE_KIND,
        filename: image.filename,
        size_bytes: image.size_bytes,
        image_storage_key: image.storage_key,
        image_content_type: image.content_type,
        is_cover: image.is_cover,
      }))
    )
    .returning(['id', 'created_at'])
    .execute();
  return new Map(rows.map((row) => [row.id, row.created_at]));
}

export async function deleteTaskImage(db: Kysely<DB>, imageId: string): Promise<void> {
  await db
    .deleteFrom('task_attachment')
    .where('task_attachment.id', '=', imageId)
    .where('task_attachment.kind', '=', MIRRORED_IMAGE_KIND)
    .execute();
}

// Clear before set: a single `is_cover = (id = $imageId)` update trips the
// partial unique index as it walks the rows.
export async function setTaskCoverImage(
  db: Kysely<DB>,
  taskId: string,
  imageId: string | null
): Promise<void> {
  await db
    .updateTable('task_attachment')
    .set({ is_cover: false })
    .where('task_attachment.task_id', '=', taskId)
    .where('task_attachment.kind', '=', MIRRORED_IMAGE_KIND)
    .where('task_attachment.is_cover', '=', true)
    .execute();

  if (imageId !== null) {
    await db
      .updateTable('task_attachment')
      .set({ is_cover: true })
      .where('task_attachment.id', '=', imageId)
      .where('task_attachment.kind', '=', MIRRORED_IMAGE_KIND)
      .execute();
  }
}
