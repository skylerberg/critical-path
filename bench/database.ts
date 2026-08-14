import { createHash } from 'node:crypto';
import { Client } from 'pg';
import {
  assertResettableDatabaseName,
  baseDatabaseName,
  checkoutRoot,
} from '../tests/setup/testDatabaseName';
import { ensureTestDatabase } from '../tests/setup/testDatabase';

// A database of its own, never the suite's and never the one you develop
// against. It carries the same `_test` suffix the suite's names do, which is
// what lets `ensureTestDatabase` create it and `pnpm run test:db:prune` reclaim
// it: it is stamped with this checkout, so deleting the worktree is enough to
// get the disk back. Sharing the suite's database instead would mean a
// benchmark run and `pnpm test` racing to truncate each other, and 400k seeded
// rows sitting under every future test run.
//
// Resolved once and remembered: `baseDatabaseName()` reads DB_DATABASE, which
// pointEnvAtBenchDatabase then overwrites with the name derived from it, so a
// second derivation would build a bench name out of a bench name.
let resolved: string | null = null;

export function benchDatabaseName(scaleName?: string): string {
  if (resolved !== null) {
    return resolved;
  }
  const override = process.env.BENCH_DB_NAME;
  if (override) {
    resolved = assertResettableDatabaseName(override);
    return resolved;
  }
  if (scaleName === undefined) {
    throw new Error('benchDatabaseName() needs the scale on its first call');
  }
  const hash = createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 8);
  // One database per tier, so switching between them is a reconnect rather than
  // a rebuild: the heavy seed is minutes of work to throw away for a fast run.
  resolved = assertResettableDatabaseName(`${baseDatabaseName()}_bench_${scaleName}_${hash}`);
  return resolved;
}

// Set before anything imports src/db, which reads env at module scope and opens
// its pool immediately. Every caller therefore has to import the app lazily.
export function pointEnvAtBenchDatabase(scaleName: string): string {
  const name = benchDatabaseName(scaleName);
  process.env.DB_DATABASE = name;
  // The suite's derivation reads TEST_DB_BASE; clearing the override keeps a
  // stray one from renaming the bench database out from under a seeded run.
  delete process.env.TEST_DB_NAME;
  process.env.DB_POOL_MAX ??= '10';
  return name;
}

export async function createBenchDatabase(): Promise<string> {
  return ensureTestDatabase(benchDatabaseName());
}

async function withBenchClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    host: process.env.DB_HOSTNAME || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: benchDatabaseName(),
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

const MARKER_TABLE = 'bench_seed_marker';

// Seeding the heavy tier is minutes of work, so a run that already has the data
// it needs skips it. The fingerprint covers the scale AND the migration count,
// so a new migration invalidates the seed rather than benchmarking a schema
// that no longer exists.
export async function readSeedMarker(): Promise<string | null> {
  return withBenchClient(async (client) => {
    const { rows } = await client.query<{ fingerprint: string }>(
      `select fingerprint from ${MARKER_TABLE} limit 1`
    );
    return rows[0]?.fingerprint ?? null;
  }).catch(() => null);
}

export async function writeSeedMarker(fingerprint: string): Promise<void> {
  await withBenchClient(async (client) => {
    await client.query(
      `create table if not exists ${MARKER_TABLE} (fingerprint text not null, seeded_at timestamptz not null default now())`
    );
    await client.query(`delete from ${MARKER_TABLE}`);
    await client.query(`insert into ${MARKER_TABLE} (fingerprint) values ($1)`, [fingerprint]);
  });
}

// Drops every application table so the next run migrates from nothing. Cheaper
// and far more predictable than truncating, because the seeded indexes are
// rebuilt from empty rather than left bloated by the previous tier.
export async function dropBenchSchema(): Promise<void> {
  await withBenchClient(async (client) => {
    await client.query('drop schema public cascade');
    await client.query('create schema public');
  });
}

// Whichever scenario runs first otherwise pays for pulling the instance off
// disk and reports the disk rather than the query, which makes a result depend
// on its position in the list. Reading the big tables once up front spreads
// that cost onto nobody.
export async function warmCache(): Promise<void> {
  await withBenchClient(async (client) => {
    const { rows } = await client.query<{ name: string }>(
      `select c.relname as name
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by pg_total_relation_size(c.oid) desc
       limit 10`
    );
    for (const row of rows) {
      // count(*) rather than pg_prewarm, which is an extension the developer's
      // Postgres may not have installed.
      await client.query(`select count(*) from "${row.name.replace(/"/g, '""')}"`);
    }
  });
}

export async function databaseSizeBytes(): Promise<number> {
  return withBenchClient(async (client) => {
    const { rows } = await client.query<{ bytes: string }>(
      'select pg_database_size(current_database())::text as bytes'
    );
    return Number(rows[0]?.bytes ?? 0);
  });
}

export async function tableSizes(): Promise<Array<{ table: string; bytes: number; rows: number }>> {
  return withBenchClient(async (client) => {
    const { rows } = await client.query<{ table: string; bytes: string; rows: string }>(
      `select c.relname as table,
              pg_total_relation_size(c.oid)::text as bytes,
              coalesce(s.n_live_tup, 0)::text as rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
       where n.nspname = 'public' and c.relkind = 'r'
       order by pg_total_relation_size(c.oid) desc
       limit 15`
    );
    return rows.map((row) => ({
      table: row.table,
      bytes: Number(row.bytes),
      rows: Number(row.rows),
    }));
  });
}
