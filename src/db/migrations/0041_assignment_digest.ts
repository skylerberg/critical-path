import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('app_user')
    .addColumn('notify_bulk_task_assigned', 'boolean', (col) => col.notNull().defaultTo(true))
    .execute();

  await db.schema
    .createTable('pending_assignment_notification')
    .addColumn('recipient_user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('actor_user_id', 'uuid', (col) =>
      col.notNull().references('app_user.id').onDelete('cascade')
    )
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('task_id', 'uuid', (col) => col.notNull().references('task.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Assigning the same card to the same person twice inside one window is one
    // line in one digest, and the first stamp is the one that decides when it
    // goes out.
    .addPrimaryKeyConstraint('pending_assignment_notification_pkey', [
      'recipient_user_id',
      'actor_user_id',
      'project_id',
      'task_id',
    ])
    .execute();

  await db.schema
    .createIndex('pending_assignment_notification_group_idx')
    .on('pending_assignment_notification')
    .columns(['recipient_user_id', 'actor_user_id', 'project_id', 'created_at'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('pending_assignment_notification').execute();
  await db.schema.alterTable('app_user').dropColumn('notify_bulk_task_assigned').execute();
}
