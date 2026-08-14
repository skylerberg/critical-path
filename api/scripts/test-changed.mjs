#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

// Runs the tests that reach what this branch has touched: every test file that
// imports a changed source file, directly or through any depth of re-export.
// `vitest related` walks the real module graph, so it catches the e2e file that
// only reaches a service through three barrels — which is exactly the case a
// hand-picked list of files misses.
//
// It is a fast check while working, not a replacement for the suite: a change
// nothing imports yet (a new file, a migration, a fixture) resolves to no tests
// at all, and a test that breaks for a reason other than an import — a shared
// database row, a global reset, an ordering assumption — is invisible to it.
// Run the full suite before opening a PR regardless.

const base = process.argv[2] ?? 'origin/main';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

let changed;
try {
  // Committed against the merge base, plus whatever is still uncommitted, so it
  // answers the same question before and after a commit.
  const mergeBase = git('merge-base', 'HEAD', base).trim();
  changed = [
    ...git('diff', '--name-only', mergeBase, '--').split('\n'),
    ...git('diff', '--name-only', '--').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').split('\n'),
  ];
} catch (err) {
  console.error(`Could not diff against ${base}: ${err.message}`);
  console.error('Pass a different base, e.g. pnpm run test:changed main');
  process.exit(1);
}

const sources = [...new Set(changed)].filter(
  (file) => file.endsWith('.ts') && !file.endsWith('.d.ts')
);

if (sources.length === 0) {
  console.log(`No changed TypeScript files against ${base}; nothing to run.`);
  process.exit(0);
}

console.log(`Tests reaching ${String(sources.length)} changed file(s) against ${base}:`);
for (const file of sources) {
  console.log(`  ${file}`);
}

const result = spawnSync(
  process.execPath,
  ['node_modules/vitest/vitest.mjs', 'related', '--run', ...sources],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
