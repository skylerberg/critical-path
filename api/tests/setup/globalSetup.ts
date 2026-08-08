import { sql } from 'kysely';
import { db } from '../../src/db/index';
import { runMigrations } from '../../src/db/migrate';
import { env } from '../../src/config/env';
import {
  acquireRunLock,
  ensureTestDatabase,
  pruneAbandonedTestDatabases,
  type RunLock,
} from './testDatabase';
import { resolveTestDatabaseName } from './testDatabaseName';

let runLock: RunLock | null = null;

export async function setup() {
  if (env.environment !== 'test') {
    throw new Error(
      `Refusing to run tests against ENVIRONMENT=${env.environment} (database ${env.db.database}). ` +
        'The suite truncates every table; run via npm test so .env.test is loaded.'
    );
  }

  const expected = resolveTestDatabaseName();
  if (env.db.database !== expected) {
    throw new Error(
      `This run would truncate ${env.db.database} instead of ${expected}, which is this ` +
        "checkout's own database. vitest.config.ts derives the name; do not set DB_DATABASE."
    );
  }

  // Before the first query: the pool points at a database that may not exist.
  await ensureTestDatabase(expected);

  // Before the truncate below, which is unconditional: a database is per
  // checkout but not per run, so two suites started from one checkout share
  // it and the second one's truncate deletes the first one's rows out from
  // under it. That surfaces as a single unrelated test failing on whatever
  // the missing row turned into — a wrong exit code, a 404 — and passing on
  // the rerun, which is the most expensive kind of failure to chase.
  runLock = await acquireRunLock(expected);

  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    console.error('Failed to connect to test database:', error);
    throw error;
  }

  const { error } = await runMigrations(db);
  if (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const tables = await db.introspection.getTables();
  const appTables = tables.map((t) => t.name).filter((name) => !name.startsWith('kysely_'));
  if (appTables.length > 0) {
    await sql`truncate table ${sql.join(appTables.map((name) => sql.table(name)))} cascade`.execute(
      db
    );
  }

  // Housekeeping only: a checkout that is gone cannot be running a suite.
  try {
    const dropped = await pruneAbandonedTestDatabases();
    if (dropped.length > 0) {
      console.log(`Dropped ${dropped.length} test database(s) whose checkout no longer exists`);
    }
  } catch (error) {
    console.warn('Could not prune abandoned test databases:', error);
  }
}

export async function teardown() {
  try {
    await db.destroy();
  } finally {
    await runLock?.release();
    runLock = null;
  }
}
