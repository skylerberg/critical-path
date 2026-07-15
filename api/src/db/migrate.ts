import * as path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import type { Kysely } from 'kysely';
import type { DB } from './types';
import { logger } from '../utils/logger';

export function createMigrator(db: Kysely<DB>): Migrator {
  const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  return new Migrator({
    db,
    provider: new FileMigrationProvider({ fs, path, migrationFolder }),
  });
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isEntrypoint) {
  const { db } = await import('./index');
  const migrator = createMigrator(db);
  const direction = process.argv[2];

  const { error, results } =
    direction === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();

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
