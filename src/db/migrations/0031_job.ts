import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('job')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('pending'))
    .addColumn('run_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('interval_seconds', 'integer')
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('job_due_idx')
    .on('job')
    .column('run_at')
    .where(sql.ref('status'), '=', 'pending')
    .execute();

  // The identity the periodic seed upserts on, and what keeps a recurring
  // schedule to exactly one row however many replicas start at once.
  await db.schema
    .createIndex('job_periodic_kind_idx')
    .on('job')
    .column('kind')
    .unique()
    .where(sql.ref('interval_seconds'), 'is not', null)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('job').execute();
}
