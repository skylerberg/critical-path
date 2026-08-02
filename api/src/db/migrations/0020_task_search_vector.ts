import { sql } from 'kysely';
import type { Kysely } from 'kysely';

// `strict` avoids the duplicate values lax `$.**` yields; the attrs.label arm is
// what keeps a card that only names someone through a mention findable by that
// name.
const DESCRIPTION_TEXT = sql`
  jsonb_path_query_array(coalesce(description, '{}'::jsonb), 'strict $.**.text') ||
  jsonb_path_query_array(coalesce(description, '{}'::jsonb), 'strict $.**.attrs.label')
`;

// The 'simple' arms are not redundant with the 'english' ones: prefix matching
// against stemmed lexemes alone drops out mid-word (typed 'authenti' cannot
// match the indexed 'authent'), which an as-you-type box cannot tolerate.
const SEARCH_VECTOR = sql`
  setweight(to_tsvector('english', title), 'A') ||
  setweight(jsonb_to_tsvector('english', ${DESCRIPTION_TEXT}, '["string"]'), 'B') ||
  setweight(to_tsvector('simple', title), 'C') ||
  setweight(jsonb_to_tsvector('simple', ${DESCRIPTION_TEXT}, '["string"]'), 'D')
`;

export async function up(db: Kysely<unknown>): Promise<void> {
  // Migrations inherit the API pool's 30s statement_timeout, which is sized for
  // a request, not for a table rewrite plus a GIN build that must also wait out
  // the locks still-running old pods hold. Raised rather than disabled so a
  // migration wedged behind a lock gives the table back instead of holding
  // ACCESS EXCLUSIVE indefinitely.
  await sql`set local statement_timeout = '240s'`.execute(db);

  await db.schema
    .alterTable('task')
    .addColumn('search_vector', sql`tsvector`, (col) =>
      col.generatedAlwaysAs(SEARCH_VECTOR).stored()
    )
    .execute();

  await db.schema
    .createIndex('task_search_vector_idx')
    .on('task')
    .using('gin')
    .column('search_vector')
    .execute();

  // The whole pending set runs in one transaction, so a raise left standing
  // governs every migration after this one too.
  await sql`set local statement_timeout = '30s'`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('task_search_vector_idx').execute();
  await db.schema.alterTable('task').dropColumn('search_vector').execute();
}
