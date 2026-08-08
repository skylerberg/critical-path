import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// 'simple' rather than 'english': names are not English words, and the english
// dictionary would both stem them and drop a user whose name is a stop word.
const NAME_SEARCH_VECTOR = sql`to_tsvector('simple', name)`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Adding a stored generated column rewrites the table under ACCESS EXCLUSIVE,
  // and app_user is on the auth path of every request, so this ceiling is
  // potential downtime rather than the degraded search 0020 risked. Accepted:
  // app_user is the smallest table in the schema, and CREATE INDEX CONCURRENTLY
  // is unavailable because the whole pending set runs in one transaction.
  await sql`set local statement_timeout = '240s'`.execute(db);

  // Stored, not virtual: PG18 defaults a generated column to VIRTUAL, and a
  // virtual column cannot be indexed.
  await db.schema
    .alterTable('app_user')
    .addColumn('name_search_vector', sql`tsvector`, (col) =>
      col.generatedAlwaysAs(NAME_SEARCH_VECTOR).stored()
    )
    .execute();

  await db.schema
    .createIndex('app_user_name_search_vector_idx')
    .on('app_user')
    .using('gin')
    .column('name_search_vector')
    .execute();

  await sql`set local statement_timeout = '30s'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('app_user_name_search_vector_idx').execute();
  await db.schema.alterTable('app_user').dropColumn('name_search_vector').execute();
}
