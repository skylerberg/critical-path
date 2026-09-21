import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

// Imported straight from the library rather than through src/services/sortKey:
// the migrator dynamic-imports this file outside the bundler, and a migration
// must keep producing the same keys however the service is later refactored.
const keysBetween = (count: number): string[] =>
  generateNKeysBetween(null, null, count, BASE_62_DIGITS);

// Labels gain the fractional-index ordering every other ranked row already
// has, scoped to the project. The column is `collate "C"` because the
// database's en_US.UTF-8 collation does not compare ASCII byte-wise, and every
// client sorts these keys with plain string comparison -- under the default
// collation the two disagree.
//
// It stays nullable for one release, the same split 0044/0048 made: a NOT NULL
// column with no default fails the previous pods' INSERTs for the whole
// rolling-deploy window. The backfill keys every existing row in the order the
// board already showed them -- name, then id -- so the new ORDER BY reads
// identically to the old one until someone reorders. Enforcement (set not
// null, unique index, backfill of any rows old pods wrote without a key) is
// the follow-up migration once every pod writes a key itself.
const BACKFILL_CHUNK = 500;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table label add column sort_key text collate "C"`.execute(db);

  const { rows } = await sql<{ id: string; project_id: string }>`
    select id, project_id from label order by project_id, name, id
  `.execute(db);

  const byProject = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byProject.get(row.project_id);
    if (bucket) bucket.push(row.id);
    else byProject.set(row.project_id, [row.id]);
  }

  const updates: { id: string; key: string }[] = [];
  for (const ids of byProject.values()) {
    const keys = keysBetween(ids.length);
    ids.forEach((id, index) => {
      updates.push({ id, key: keys[index]! });
    });
  }

  for (let start = 0; start < updates.length; start += BACKFILL_CHUNK) {
    const chunk = updates.slice(start, start + BACKFILL_CHUNK);
    const values = chunk.map((update) => sql`(${update.id}::uuid, ${update.key}::text)`);
    await sql`
      update label
      set sort_key = v.sort_key
      from (values ${sql.join(values)}) as v(id, sort_key)
      where label.id = v.id
    `.execute(db);
  }

  await sql`
    create index label_project_id_sort_key_idx on label (project_id, sort_key, id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop index if exists label_project_id_sort_key_idx`.execute(db);
  await sql`alter table label drop column sort_key`.execute(db);
}
