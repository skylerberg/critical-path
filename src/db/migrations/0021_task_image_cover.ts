import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  // Every pending migration shares one transaction, so ADD COLUMN's ACCESS
  // EXCLUSIVE lock blocks reads of task_image until commit; fail fast instead.
  await sql`set local lock_timeout = '3s'`.execute(db);

  await db.schema
    .alterTable('task_image')
    .addColumn('is_cover', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createIndex('task_image_cover_idx')
    .on('task_image')
    .column('task_id')
    .unique()
    .where(sql.ref('is_cover'), '=', true)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('task_image_cover_idx').execute();
  await db.schema.alterTable('task_image').dropColumn('is_cover').execute();
}
