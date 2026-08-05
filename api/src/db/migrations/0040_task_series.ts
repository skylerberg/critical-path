import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('task_series')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    // Deleting a column that holds only series reports itself empty and returns
    // 204, so a cascade here would silently destroy the schedule. Nulling it
    // stops the sweep and the panel asks for a new destination.
    .addColumn('column_id', 'uuid', (col) => col.references('board_column.id').onDelete('set null'))
    // A series belongs to the project, not to whoever set it up; cascading would
    // let a departing member destroy schedules in projects they did not own.
    .addColumn('created_by', 'uuid', (col) => col.references('app_user.id').onDelete('set null'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'jsonb')
    // Never derived from the occurrence: the occurrence decides only when a
    // card comes into existence.
    .addColumn('due_date', 'date')
    .addColumn('rrule', 'text', (col) => col.notNull())
    .addColumn('start_date', 'date', (col) => col.notNull())
    .addColumn('timezone', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('next_occurrence_date', 'date')
    .addColumn('next_occurrence_at', 'timestamptz')
    .addColumn('last_occurrence_date', 'date')
    .addColumn('missed_occurrence_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_missed_date', 'date')
    .addColumn('consecutive_failures', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('ended_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('task_series_title_not_empty', sql`char_length(title) > 0`)
    .execute();

  await db.schema
    .createIndex('task_series_due_idx')
    .on('task_series')
    .columns(['next_occurrence_at', 'id'])
    .where(sql.ref('status'), '=', 'active')
    .execute();

  await db.schema
    .createIndex('task_series_project_id_created_at_id_idx')
    .on('task_series')
    .columns(['project_id', 'created_at', 'id'])
    .execute();

  await db.schema
    .createTable('task_series_label')
    .addColumn('series_id', 'uuid', (col) =>
      col.notNull().references('task_series.id').onDelete('cascade')
    )
    .addColumn('label_id', 'uuid', (col) =>
      col.notNull().references('label.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('task_series_label_pkey', ['series_id', 'label_id'])
    .execute();

  await db.schema
    .createTable('task_series_assignee')
    .addColumn('series_id', 'uuid', (col) =>
      col.notNull().references('task_series.id').onDelete('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addPrimaryKeyConstraint('task_series_assignee_pkey', ['series_id', 'user_id'])
    .execute();

  await db.schema
    .createTable('task_series_checklist_item')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('series_id', 'uuid', (col) =>
      col.notNull().references('task_series.id').onDelete('cascade')
    )
    .addColumn('text', 'text', (col) => col.notNull())
    .addColumn('position', 'double precision', (col) => col.notNull())
    .addCheckConstraint('task_series_checklist_item_text_not_empty', sql`char_length(text) > 0`)
    .execute();

  await db.schema
    .createIndex('task_series_checklist_item_series_id_position_idx')
    .on('task_series_checklist_item')
    .columns(['series_id', 'position', 'id'])
    .execute();

  // Ending a schedule must leave a year of completed invoices behind, so the
  // card outlives the series it came from.
  await db.schema
    .alterTable('task')
    .addColumn('series_id', 'uuid', (col) => col.references('task_series.id').onDelete('set null'))
    .execute();

  await db.schema.alterTable('task').addColumn('series_occurrence_date', 'date').execute();

  await db.schema
    .createIndex('task_series_occurrence_idx')
    .on('task')
    .columns(['series_id', 'series_occurrence_date'])
    .unique()
    .where(sql.ref('series_id'), 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('task_series_occurrence_idx').execute();
  await db.schema.alterTable('task').dropColumn('series_occurrence_date').execute();
  await db.schema.alterTable('task').dropColumn('series_id').execute();
  await db.schema.dropTable('task_series_checklist_item').execute();
  await db.schema.dropTable('task_series_assignee').execute();
  await db.schema.dropTable('task_series_label').execute();
  await db.schema.dropTable('task_series').execute();
}
