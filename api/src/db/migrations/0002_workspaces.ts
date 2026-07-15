import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('workspace')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('workspace_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createTable('workspace_member')
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspace.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('workspace_member_pkey', ['workspace_id', 'user_id'])
    .execute();

  await db.schema
    .createIndex('workspace_member_user_id_idx')
    .on('workspace_member')
    .column('user_id')
    .execute();

  // Nullable for rolling deploys: old code still inserts projects without created_by.
  await db.schema
    .alterTable('project')
    .addColumn('created_by', 'uuid', (col) => col.references('app_user.id').onDelete('cascade'))
    .execute();

  await db.schema
    .alterTable('project')
    .addColumn('workspace_id', 'uuid', (col) => col.references('workspace.id').onDelete('set null'))
    .execute();

  await sql`
    update project
    set created_by = (select id from app_user order by created_at, id limit 1)
    where created_by is null
  `.execute(db);

  await db.schema
    .createIndex('project_created_by_idx')
    .on('project')
    .column('created_by')
    .execute();

  await db.schema
    .createIndex('project_workspace_id_idx')
    .on('project')
    .column('workspace_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('project').dropColumn('workspace_id').execute();
  await db.schema.alterTable('project').dropColumn('created_by').execute();
  await db.schema.dropTable('workspace_member').execute();
  await db.schema.dropTable('workspace').execute();
}
