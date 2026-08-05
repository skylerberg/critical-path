import { sql } from 'kysely';
import { db } from '../../src/db/index';
import { runMigrations } from '../../src/db/migrate';
import { env } from '../../src/config/env';
import { ensureTestDatabase, pruneAbandonedTestDatabases } from './testDatabase';
import { resolveTestDatabaseName } from './testDatabaseName';

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
  await db.destroy();
}
