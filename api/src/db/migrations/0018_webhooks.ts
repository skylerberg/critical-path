import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('project_webhook')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('project.id').onDelete('cascade')
    )
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('secret', 'text', (col) => col.notNull())
    .addColumn('disabled_at', 'timestamptz')
    .addColumn('consecutive_failures', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('project_webhook_project_id_url_key', ['project_id', 'url'])
    .execute();

  await db.schema
    .createIndex('project_webhook_project_id_idx')
    .on('project_webhook')
    .column('project_id')
    .execute();

  await db.schema
    .createTable('webhook_delivery')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('webhook_id', 'uuid', (col) =>
      col.notNull().references('project_webhook.id').onDelete('cascade')
    )
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('attempt_count', 'integer', (col) => col.notNull().defaultTo(0))
    // A manual resend resets attempt_count, so this counter carries the history
    // and keeps resends from driving auto-disable.
    .addColumn('redelivery_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('next_attempt_at', 'timestamptz')
    .addColumn('last_attempt_at', 'timestamptz')
    .addColumn('last_status_code', 'integer')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('webhook_delivery_webhook_id_created_at_idx')
    .on('webhook_delivery')
    .columns(['webhook_id', 'created_at desc'])
    .execute();

  await db.schema
    .createIndex('webhook_delivery_due_idx')
    .on('webhook_delivery')
    .column('next_attempt_at')
    .where(sql.ref('status'), '=', 'pending')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('webhook_delivery').execute();
  await db.schema.dropTable('project_webhook').execute();
}
