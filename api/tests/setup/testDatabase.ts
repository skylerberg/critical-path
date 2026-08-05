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
