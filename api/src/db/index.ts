import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import type { DB } from './types';
import { env } from '../config/env';
import fs from 'fs/promises';
import { logger } from '../utils/logger';

let caCert: string | undefined;
if (env.db.caCertPath) {
  try {
    caCert = await fs.readFile(env.db.caCertPath, 'utf-8');
  } catch {
    logger.warn({ msg: 'Failed to read DB CA certificate', path: env.db.caCertPath });
  }
}

const STATEMENT_TIMEOUT_MS = 30_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;

const pool = new Pool({
  host: env.db.hostname,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  ssl: caCert ? { rejectUnauthorized: true, ca: caCert } : false,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS} -c idle_in_transaction_session_timeout=${IDLE_IN_TRANSACTION_TIMEOUT_MS}`,
});

pool.on('error', (err) => {
  logger.error({
    msg: 'pg pool error',
    error: err instanceof Error ? err.message : String(err),
    code: (err as NodeJS.ErrnoException).code,
  });
});

export const db = new Kysely<DB>({
  log: env.environment === 'development' ? ['query', 'error'] : ['error'],
  dialect: new PostgresDialect({
    pool,
  }),
});
