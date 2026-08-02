import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project_invitation')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('email', 'text', (col) => col.notNull())
    // Stored rather than lowercased on write so the address keeps the casing
    // the inviter typed while the unique target stays a plain column.
    .addColumn('email_lower', 'text', (col) => col.generatedAlwaysAs(sql`lower(email)`).stored())
    .addColumn('role', 'text', (col) => col.notNull().defaultTo('editor'))
    .addColumn('invited_by', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('token_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addCheckConstraint('project_invitation_email_not_empty', sql`char_length(email) > 0`)
    .addCheckConstraint('project_invitation_role_valid', sql`role in ('editor', 'viewer')`)
    .execute();

  await db.schema
    .createIndex('project_invitation_project_email_idx')
    .on('project_invitation')
    .columns(['project_id', 'email_lower'])
    .unique()
    .execute();

  await db.schema
    .createIndex('project_invitation_token_hash_idx')
    .on('project_invitation')
    .column('token_hash')
    .unique()
    .execute();

  await db.schema
    .createIndex('project_invitation_email_lower_idx')
    .on('project_invitation')
    .column('email_lower')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('project_invitation').execute();
}
