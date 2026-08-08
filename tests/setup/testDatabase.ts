import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import {
  CHECKOUT_COMMENT_PREFIX,
  assertResettableDatabaseName,
  baseDatabaseName,
  checkoutRoot,
  resolveTestDatabaseName,
} from './testDatabaseName';

const DUPLICATE_DATABASE = '42P04';
const DATABASE_IN_USE = '55006';
const INSUFFICIENT_PRIVILEGE = '42501';

export interface TestDatabase {
  name: string;
  checkout: string | null;
  bytes: number;
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function quoteIdentifier(name: string): string {
  return `"${assertResettableDatabaseName(name).replace(/"/g, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// The maintenance database only has to exist; nothing here reads or writes it.
async function connectMaintenance(): Promise<Client> {
  const client = new Client({
    host: process.env.DB_HOSTNAME || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_MAINTENANCE_DATABASE || 'postgres',
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

async function withMaintenance<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await connectMaintenance();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export interface RunLock {
  release(): Promise<void>;
}

// Advisory lock keys are signed 64-bit, which is exactly what the first eight
// bytes of the digest read as. The name is in the key, so every run targeting
// one database contends and runs targeting different ones never do.
function runLockKey(name: string): string {
  return createHash('sha256')
    .update(`critical-path-api test run:${name}`)
    .digest()
    .readBigInt64BE(0)
    .toString();
}

async function describeConflict(client: Client, name: string): Promise<string> {
  const { rows } = await client.query<{ pid: number }>(
    `select pid from pg_stat_activity
     where datname = $1 and pid <> pg_backend_pid()
     order by pid`,
    [name]
  );
  const backends = rows.length > 0 ? ` Backends on it: ${rows.map((r) => r.pid).join(', ')}.` : '';
  return (
    `Another test run already holds ${name}, so this one refuses to start: the truncate it ` +
    `is about to run would wipe that run's rows mid-flight and fail it somewhere unrelated.` +
    `${backends} Wait for it to finish, or run from a separate worktree — vitest.config.ts ` +
    'derives one database per checkout, which is what lets suites run side by side.'
  );
}

// Session-scoped, and held on a client of its own: a pooled connection goes
// back to the pool and takes the lock with it. A run that dies without
// releasing drops the connection, which is itself the release.
export async function acquireRunLock(name: string = resolveTestDatabaseName()): Promise<RunLock> {
  assertResettableDatabaseName(name);
  const key = runLockKey(name);
  const client = await connectMaintenance();

  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1::bigint) as locked',
      [key]
    );
    if (!rows[0].locked) {
      throw new Error(await describeConflict(client, name));
    }
  } catch (error) {
    await client.end();
    throw error;
  }

  return {
    async release() {
      try {
        await client.query('select pg_advisory_unlock($1::bigint)', [key]);
      } finally {
        await client.end();
      }
    },
  };
}

export async function ensureTestDatabase(
  name: string = resolveTestDatabaseName()
): Promise<string> {
  assertResettableDatabaseName(name);

  await withMaintenance(async (client) => {
    try {
      await client.query(`create database ${quoteIdentifier(name)}`);
    } catch (error) {
      if (errorCode(error) === INSUFFICIENT_PRIVILEGE) {
        throw new Error(
          `${process.env.DB_USER || 'postgres'} may not create ${name}. Grant CREATEDB, or set ` +
            'TEST_DB_NAME to a database that already exists.',
          { cause: error }
        );
      }
      if (errorCode(error) !== DUPLICATE_DATABASE) {
        throw error;
      }
    }

    // Rewritten every run, so a database whose checkout was deleted and
    // recreated at the same path is claimed again rather than pruned.
    await client.query(
      `comment on database ${quoteIdentifier(name)} is ${quoteLiteral(
        `${CHECKOUT_COMMENT_PREFIX}${checkoutRoot}`
      )}`
    );
  });

  return name;
}

export async function listTestDatabases(): Promise<TestDatabase[]> {
  return withMaintenance(async (client) => {
    const { rows } = await client.query<{ name: string; comment: string | null; bytes: string }>(
      `select datname as name,
              shobj_description(oid, 'pg_database') as comment,
              pg_database_size(oid)::text as bytes
       from pg_database
       where datistemplate = false and starts_with(datname, $1)
       order by datname`,
      [`${baseDatabaseName()}_`]
    );

    return rows.map((row) => ({
      name: row.name,
      checkout: row.comment?.startsWith(CHECKOUT_COMMENT_PREFIX)
        ? row.comment.slice(CHECKOUT_COMMENT_PREFIX.length)
        : null,
      bytes: Number(row.bytes),
    }));
  });
}

// A database still in use belongs to a suite running right now, so it is
// skipped rather than forced: the point of all this is not to disturb one.
export async function dropTestDatabases(names: string[]): Promise<string[]> {
  if (names.length === 0) {
    return [];
  }

  return withMaintenance(async (client) => {
    const dropped: string[] = [];
    for (const name of names) {
      try {
        await client.query(`drop database ${quoteIdentifier(name)}`);
        dropped.push(name);
      } catch (error) {
        if (errorCode(error) !== DATABASE_IN_USE) {
          throw error;
        }
      }
    }
    return dropped;
  });
}

export function isAbandoned(database: TestDatabase): boolean {
  return database.checkout !== null && !existsSync(database.checkout);
}

// Only databases this scheme created and stamped are pruned. Anything older
// carries no checkout comment and is left for `npm run test:db:prune --legacy`.
export async function pruneAbandonedTestDatabases(): Promise<string[]> {
  const abandoned = (await listTestDatabases())
    .filter(isAbandoned)
    .map((database) => database.name);
  return dropTestDatabases(abandoned);
}
