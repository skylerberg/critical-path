import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

// cli/ is a sibling package in this monorepo, not a subdirectory: it has no
// vitest of its own, so its tests run in this suite and the glob has to climb
// out of api/. Asserted rather than trusted, because vitest answers a glob over
// a path that does not exist by collecting nothing and exiting 0 — so moving or
// renaming cli/tests takes the CLI's entire suite out of CI and reports the same
// green as before. `SIBLING_TEST_DIRS` in scripts/test-changed.mjs names the
// same directory and has to move with it.
const CLI_TESTS = '../cli/tests';
if (!existsSync(fileURLToPath(new URL(`${CLI_TESTS}/`, import.meta.url)))) {
  throw new Error(
    `${CLI_TESTS} is missing. This suite is the only thing that runs the CLI's tests, and a ` +
      'glob over an absent path collects nothing and passes, so this refuses to start rather ' +
      'than run a suite that is quietly smaller than it looks.'
  );
}

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
    include: ['tests/e2e/**/*.test.ts', 'tests/unit/**/*.test.ts', `${CLI_TESTS}/**/*.test.ts`],
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
