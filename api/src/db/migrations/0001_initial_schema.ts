import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('app_user')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('app_user_email_not_empty', sql`char_length(email) > 0`)
    .addCheckConstraint('app_user_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createIndex('app_user_email_lower_unique')
    .unique()
    .on('app_user')
    .expression(sql`lower(email)`)
    .execute();

  await db.schema
    .createTable('session')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('session_user_id_idx').on('session').column('user_id').execute();

  await db.schema
    .createTable('project')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('is_template', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('archived_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('project_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createTable('board_column')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('position', 'float8', (col) => col.notNull())
    .addColumn('is_done', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('board_column_name_not_empty', sql`char_length(name) > 0`)
    .execute();

  await db.schema
    .createIndex('board_column_project_id_idx')
    .on('board_column')
    .column('project_id')
    .execute();

  await db.schema
    .createTable('task')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('column_id', 'uuid', (col) =>
      col.notNull().references('board_column.id').onDelete('cascade')
    )
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'jsonb')
    .addColumn('position', 'float8', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('task_title_not_empty', sql`char_length(title) > 0`)
    .execute();

  await db.schema.createIndex('task_project_id_idx').on('task').column('project_id').execute();
  await db.schema.createIndex('task_column_id_idx').on('task').column('column_id').execute();

  await db.schema
    .createTable('task_dependency')
    .addColumn('blocker_task_id', 'uuid', (col) =>
      col.notNull().references('task.id').onDelete('cascade')
    )
    .addColumn('blocked_task_id', 'uuid', (col) =>
      col.notNull().references('task.id').onDelete('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('task_dependency_pkey', ['blocker_task_id', 'blocked_task_id'])
    .addCheckConstraint('task_dependency_no_self', sql`blocker_task_id <> blocked_task_id`)
    .execute();

  await db.schema
    .createIndex('task_dependency_blocked_task_id_idx')
    .on('task_dependency')
    .column('blocked_task_id')
    .execute();

  await db.schema
    .createTable('label')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('color', 'text', (col) => col.notNull())
    .addUniqueConstraint('label_project_id_name_unique', ['project_id', 'name'])
    .addCheckConstraint('label_name_not_empty', sql`char_length(name) > 0`)
    .addCheckConstraint('label_color_not_empty', sql`char_length(color) > 0`)
    .execute();

  await db.schema.createIndex('label_project_id_idx').on('label').column('project_id').execute();

  await db.schema
    .createTable('task_label')
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('label_id', 'uuid', (col) =>
      col.notNull().references('label.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('task_label_pkey', ['task_id', 'label_id'])
    .execute();

  await db.schema
    .createIndex('task_label_label_id_idx')
    .on('task_label')
    .column('label_id')
    .execute();

  await db.schema
    .createTable('task_assignee')
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('task_assignee_pkey', ['task_id', 'user_id'])
    .execute();

  await db.schema
    .createIndex('task_assignee_user_id_idx')
    .on('task_assignee')
    .column('user_id')
    .execute();

  await db.schema
    .createTable('task_image')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('storage_key', 'text', (col) => col.notNull())
    .addColumn('filename', 'text', (col) => col.notNull())
    .addColumn('content_type', 'text', (col) => col.notNull())
    .addColumn('size_bytes', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('task_image_task_id_idx')
    .on('task_image')
    .column('task_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('task_image').execute();
  await db.schema.dropTable('task_assignee').execute();
  await db.schema.dropTable('task_label').execute();
  await db.schema.dropTable('label').execute();
  await db.schema.dropTable('task_dependency').execute();
  await db.schema.dropTable('task').execute();
  await db.schema.dropTable('board_column').execute();
  await db.schema.dropTable('project').execute();
  await db.schema.dropTable('session').execute();
  await db.schema.dropTable('app_user').execute();
}
