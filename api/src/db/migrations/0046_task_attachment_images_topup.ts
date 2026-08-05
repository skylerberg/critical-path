import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// 0045 backfilled task_image before the pods that mirror new images had rolled,
// so any image uploaded during that rollout reached task_image alone. This run
// sweeps those up, immediately before reads move to task_attachment — after
// this, nothing is left that only the old table knows about.
//
// Deliberately re-runnable and deliberately not a no-op assumption: it is the
// only thing standing between a straggler and an image that vanishes from its
// card when reads flip.
export async function up(db: Kysely<unknown>): Promise<void> {
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

// The rows this added are indistinguishable from the ones 0045 added, and 0045's
// own down() already removes every kind='image' row.
export async function down(): Promise<void> {}
