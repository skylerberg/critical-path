import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  dropTestDatabases,
  ensureTestDatabase,
  listTestDatabases,
} from '../tests/setup/testDatabase';
import {
  assertResettableDatabaseName,
  baseDatabaseName,
  checkoutRoot,
} from '../tests/setup/testDatabaseName';

const OUT_FILE = './src/db/types.generated.ts';

// Introspecting a database somebody develops against makes the committed types
// a function of that machine rather than of the migrations: a column left over
// from an abandoned branch is indistinguishable from one a migration creates,
// and it lands in the commit looking exactly like the real ones. So the schema
// is built from `src/db/migrations` into a scratch database, read, and dropped.
//
// Named per checkout, the same as the test databases and for the same reason:
// two worktrees can regenerate at once. It carries the checkout stamp too, so
// `pnpm run test:db:prune` reclaims one this script failed to drop.
const scratchDatabase = assertResettableDatabaseName(
  `${baseDatabaseName()}_codegen_${createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 8)}`
);

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? code}`));
    });
  });
}

function databaseUrl(database: string): string {
  const user = encodeURIComponent(process.env.DB_USER || 'postgres');
  const password = process.env.DB_PASSWORD;
  const credentials = password ? `${user}:${encodeURIComponent(password)}` : user;
  const host = process.env.DB_HOSTNAME || '127.0.0.1';
  const port = process.env.DB_PORT || '5432';
  return `postgres://${credentials}@${host}:${port}/${database}`;
}

// A previous run that died before its drop leaves the schema it built behind,
// and migrating onto it would reproduce exactly the drift this script exists to
// avoid. Dropped by listing rather than unconditionally: on the ordinary run
// there is nothing there, and `drop database` on a missing one is an error.
async function dropScratchDatabase(): Promise<string[]> {
  const existing = await listTestDatabases();
  if (!existing.some((database) => database.name === scratchDatabase)) {
    return [];
  }
  return dropTestDatabases([scratchDatabase]);
}

await dropScratchDatabase();
await ensureTestDatabase(scratchDatabase);

try {
  console.log(`Migrating ${scratchDatabase} from src/db/migrations`);
  await run('node', ['--import', 'tsx', 'src/db/migrate.ts'], { DB_DATABASE: scratchDatabase });

  console.log(`Introspecting ${scratchDatabase}`);
  await run('kysely-codegen', [
    '--dialect',
    'postgres',
    '--url',
    databaseUrl(scratchDatabase),
    '--out-file',
    OUT_FILE,
  ]);

  // kysely-codegen has its own formatter, so without this every regeneration
  // rewraps the file and the real schema change arrives buried in a whitespace
  // diff.
  await run('prettier', ['--write', OUT_FILE]);
} finally {
  const dropped = await dropTestDatabases([scratchDatabase]);
  if (dropped.length === 0) {
    console.warn(
      `Left ${scratchDatabase} behind: something still holds a connection to it. ` +
        'The next run drops it first, or `pnpm run test:db:prune` will once this checkout is gone.'
    );
  }
}
