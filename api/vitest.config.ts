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

// The default reporter redraws a live tree, which needs a terminal to redraw
// into: with output going to a file or a CI log it prints the run's result only
// once everything has finished, so a suite that takes twenty minutes says
// nothing for twenty minutes and a hang is indistinguishable from work. The
// verbose reporter emits a line per test as it lands, which is what makes a
// redirected run followable and a stall obvious.
//
// Whatever you do, do not read a run through `| tail` — a pipe cannot show you
// anything until the command exits, whichever reporter is chosen. Redirect and
// `tail -f`.
const reporters = process.stdout.isTTY ? ['default'] : ['verbose'];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    reporters,
    pool: 'forks',
    // Files within a run still share this checkout's database, so they must
    // not run concurrently; this also forces a single worker.
    fileParallelism: false,
    env: { TEST_DB_BASE: base, DB_DATABASE: database, DB_POOL_MAX: poolMax },
    // cli/ is a sibling package in this monorepo, not a subdirectory: its tests
    // run in this suite, so the glob has to climb out of api/. Pointed at a
    // path that does not exist, vitest collects nothing from it and exits 0.
    include: [
      'tests/e2e/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      '../cli/tests/**/*.test.ts',
    ],
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
