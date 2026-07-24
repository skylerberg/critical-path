import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('app_user')
    .addColumn('avatar_storage_key', 'uuid')
    .addColumn('avatar_content_type', 'text')
    .execute();

  await db.schema
    .createIndex('app_user_avatar_storage_key_idx')
    .on('app_user')
    .column('avatar_storage_key')
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('app_user_avatar_storage_key_idx').execute();
  await db.schema
    .alterTable('app_user')
    .dropColumn('avatar_storage_key')
    .dropColumn('avatar_content_type')
    .execute();
}
