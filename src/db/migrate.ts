import * as path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { FileMigrationProvider, Migrator, type MigrationResultSet } from 'kysely/migration';
import { sql, type Kysely } from 'kysely';
import type { DB } from './types';
import { logger } from '../utils/logger';

// Well under deadlock_timeout, so a migration that cannot get a table always
// aborts itself rather than letting the deadlock detector choose between it and
// a user's request. Waiting longer cannot help when the holder is itself
// blocked behind us, and every millisecond of it stalls traffic, so the budget
// goes into more attempts rather than longer ones.
const LOCK_TIMEOUT_MS = 100;

const MAX_ATTEMPTS = 30;
const RETRYABLE_SQLSTATES = new Set(['40P01', '55P03']);

function createMigrator(db: Kysely<DB>): Migrator {
  const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  return new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  });
}

function isLockContention(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && RETRYABLE_SQLSTATES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(db: Kysely<DB>, direction: string): Promise<MigrationResultSet> {
  // The migrator opens its own transaction, and it reuses this connection, so a
  // session-level setting here is what the migrations end up running under.
  return db.connection().execute(async (connection) => {
    await sql`set lock_timeout = ${sql.lit(LOCK_TIMEOUT_MS)}`.execute(connection);
    const migrator = createMigrator(connection);
    try {
      return direction === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();
    } finally {
      await sql`reset lock_timeout`.execute(connection);
    }
  });
}

// Every pending migration runs in one transaction, so a run that loses a lock
// race leaves nothing behind and the retry starts from the same state. Only
// lock contention is retried: a migration that is simply wrong still fails on
// the first attempt.
export async function runMigrations(
  db: Kysely<DB>,
  direction: string = 'up'
): Promise<MigrationResultSet> {
  for (let attempt = 1; ; attempt++) {
    const outcome = await runOnce(db, direction);
    if (attempt >= MAX_ATTEMPTS || !isLockContention(outcome.error)) {
      return outcome;
    }
    logger.warn({
      msg: 'Migration run lost a lock race, retrying',
      attempt,
      code: (outcome.error as { code?: string }).code,
    });
    await sleep(Math.min(2_000, 100 * 2 ** (attempt - 1)) + Math.random() * 100);
  }
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  const { db } = await import('./index');
  const { error, results } = await runMigrations(db, process.argv[2]);

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      logger.info({ msg: `Migration ${result.direction}: ${result.migrationName}` });
    } else if (result.status === 'Error') {
      logger.error({ msg: `Migration failed: ${result.migrationName}` });
    }
  }

  if (error) {
    logger.error({
      msg: 'Migration run failed',
      error: error instanceof Error ? error.message : String(error),
    });
    await db.destroy();
    process.exit(1);
  }

  await db.destroy();
}
