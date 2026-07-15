import { sql } from 'kysely';
import { db } from '../../src/db/index';
import { createMigrator } from '../../src/db/migrate';
import { env } from '../../src/config/env';

export async function setup() {
  if (env.environment !== 'test') {
    throw new Error(
      `Refusing to run tests against ENVIRONMENT=${env.environment} (database ${env.db.database}). ` +
        'The suite truncates every table; run via npm test so .env.test is loaded.'
    );
  }

  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    console.error('Failed to connect to test database:', error);
    throw error;
  }

  const migrator = createMigrator(db);
  const { error } = await migrator.migrateToLatest();
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
}

export async function teardown() {
  await db.destroy();
}
