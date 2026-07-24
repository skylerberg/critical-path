import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project_member')
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('project_member_pkey', ['project_id', 'user_id'])
    .execute();

  await db.schema
    .createIndex('project_member_user_id_idx')
    .on('project_member')
    .column('user_id')
    .execute();

  // Creators have implicit access and must never get a member row.
  await sql`
    insert into project_member (project_id, user_id)
    select p.id, wm.user_id
    from project p
    join workspace_member wm on wm.workspace_id = p.workspace_id
    where wm.user_id <> p.created_by
    on conflict do nothing
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('project_member').execute();
}
