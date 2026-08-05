import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { db } from '../helpers/database';
import { newId, uniqueEmail } from '../helpers/fixtures';
import { up, down } from '../../src/db/migrations/0044_sort_key';
import { isValidSortKey } from '../../src/services/sortKey';

const SORT_KEY_TABLES = [
  'task',
  'board_column',
  'checklist_item',
  'project_user_position',
  'task_series_checklist_item',
] as const;

const userId = newId();
const projectId = newId();
const columnIds = [newId(), newId()];
const taskPositions = [300, 100, 200, -50, 1e7];

async function seed(): Promise<void> {
  await db
    .insertInto('app_user')
    .values({ id: userId, email: uniqueEmail('sortkey'), password_hash: 'x', name: 'Sort Key' })
    .execute();
  await db
    .insertInto('project')
    .values({ id: projectId, name: 'Sort Key', created_by: userId })
    .execute();
  await db
    .insertInto('board_column')
    .values(
      columnIds.map((id, index) => ({
        id,
        project_id: projectId,
        name: `C${index}`,
        position: index,
      }))
    )
    .execute();

  for (const columnId of columnIds) {
    await db
      .insertInto('task')
      .values(
        taskPositions.map((position) => ({
          id: newId(),
          project_id: projectId,
          column_id: columnId,
          title: `t${position}`,
          position,
        }))
      )
      .execute();
  }
}

describe('sort_key migration', () => {
  beforeAll(async () => {
    await seed();
    const schema = db as unknown as Kysely<unknown>;
    await down(schema);
    await up(schema);
  });

  afterAll(async () => {
    await db.deleteFrom('project').where('id', '=', projectId).execute();
    await db.deleteFrom('app_user').where('id', '=', userId).execute();
  });

  it('declares every sort_key column with the C collation', async () => {
    const { rows } = await sql<{ table_name: string; collation_name: string | null }>`
      select table_name, collation_name
      from information_schema.columns
      where table_schema = 'public' and column_name = 'sort_key'
    `.execute(db);

    expect(rows.map((row) => row.table_name).sort()).toEqual([...SORT_KEY_TABLES].sort());
    for (const row of rows) {
      expect(row.collation_name).toBe('C');
    }
  });

  // The database is en_US.UTF-8, under which 'a0' sorts before 'B0'. Clients
  // sort these keys with plain string comparison, so a column without the C
  // collation would silently disagree with every client that generated them.
  it('orders keys the same way the clients do', async () => {
    const keys = ['a0', 'B0', 'Zz', 'a0V', '0z', 'zZ', 'V1', 'V0V'];
    const { rows } = await sql<{ sort_key: string }>`
      select sort_key from task where sort_key is not null order by sort_key
    `.execute(db);
    expect(rows.length).toBeGreaterThan(0);

    const { rows: sorted } = await sql<{ k: string }>`
      select k from unnest(${sql.val(keys)}::text[]) as k order by k collate "C"
    `.execute(db);

    expect(sorted.map((row) => row.k)).toEqual([...keys].sort());
    expect(rows.map((row) => row.sort_key)).toEqual([...rows.map((row) => row.sort_key)].sort());
  });

  it('backfills keys in position order, scoped per column', async () => {
    for (const columnId of columnIds) {
      const { rows } = await sql<{ position: number; sort_key: string }>`
        select position, sort_key from task where column_id = ${columnId} order by position
      `.execute(db);

      expect(rows.map((row) => Number(row.position))).toEqual(
        [...taskPositions].sort((a, b) => a - b)
      );
      expect(rows.map((row) => row.sort_key)).toEqual([...rows.map((row) => row.sort_key)].sort());
      expect(new Set(rows.map((row) => row.sort_key)).size).toBe(rows.length);
      for (const row of rows) expect(isValidSortKey(row.sort_key)).toBe(true);
    }
  });

  it('assigns each scope its own key range', async () => {
    const { rows } = await sql<{ sort_key: string }>`
      select sort_key from task where column_id = ${columnIds[0]} order by sort_key
    `.execute(db);
    const { rows: other } = await sql<{ sort_key: string }>`
      select sort_key from task where column_id = ${columnIds[1]} order by sort_key
    `.execute(db);

    expect(rows.map((row) => row.sort_key)).toEqual(other.map((row) => row.sort_key));
  });

  it('leaves every existing row with a key', async () => {
    for (const table of SORT_KEY_TABLES) {
      const { rows } = await sql<{ missing: string }>`
        select count(*) as missing from ${sql.ref(table)} where sort_key is null
      `.execute(db);
      expect(Number(rows[0]!.missing)).toBe(0);
    }
  });
});
