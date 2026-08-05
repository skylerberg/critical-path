import { spawn } from 'node:child_process';
import { ensureTestDatabase } from '../tests/setup/testDatabase';
import { baseDatabaseName, resolveTestDatabaseName } from '../tests/setup/testDatabaseName';

// vitest.config.ts covers the suite; this covers everything else that has to
// reach the same database, which today is `npm run migrate:test`.
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: with-test-db <command> [args...]');
  process.exit(2);
}

const base = baseDatabaseName();
process.env.TEST_DB_BASE = base;
const database = resolveTestDatabaseName();
await ensureTestDatabase(database);

const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, TEST_DB_BASE: base, DB_DATABASE: database },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
