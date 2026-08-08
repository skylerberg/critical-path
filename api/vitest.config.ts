import { defineConfig } from 'vitest/config';
import { baseDatabaseName, resolveTestDatabaseName } from './tests/setup/testDatabaseName';

// Every way of starting the suite loads this file, including the single-file
// command in CLAUDE.md, so this is the one place that can guarantee a checkout
// gets its own database. Agents work in parallel worktrees off one .env.test;
// sharing the name meant one suite's opening TRUNCATE wiped another's rows
// mid-run, or blocked behind its transactions until the statement timeout.
const base = baseDatabaseName();
process.env.TEST_DB_BASE = base;
const database = resolveTestDatabaseName();
process.env.DB_DATABASE = database;

// max_connections is 100 by default and every concurrent suite holds a pool.
// Five leaves room for the lock-ordering tests, which need three at once.
process.env.DB_POOL_MAX ??= '5';
const poolMax = process.env.DB_POOL_MAX;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    // Files within a run still share this checkout's database, so they must
    // not run concurrently; this also forces a single worker.
    fileParallelism: false,
    env: { TEST_DB_BASE: base, DB_DATABASE: database, DB_POOL_MAX: poolMax },
    include: ['tests/e2e/**/*.test.ts', 'tests/unit/**/*.test.ts', 'cli/tests/**/*.test.ts'],
    globalSetup: ['./tests/setup/globalSetup.ts'],
    setupFiles: ['./tests/setup/assertTestDatabase.ts', './tests/setup/resetProcessState.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/db/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
