#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
//
// In a monorepo the two halves speak different paths: git names files from the
// repo root (`api/src/foo.ts`), vitest resolves them from its own root (`api/`).
// Handing git's answer straight over fails silently — `vitest related` prints
// "No test files found" and exits 0, after this script has already listed the
// changed files, so the no-op reads as a pass. Every path is therefore rebased
// onto the vitest root below, and every path belonging to a package this
// project has no tests for is reported as skipped rather than quietly dropped.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Resolved from this file's own location, not from cwd, so the vitest root is
// the same whether the script is reached through `pnpm run test:changed` or as
// `node api/scripts/test-changed.mjs` from the checkout root.
let repoRoot;
try {
  repoRoot = path.resolve(
    execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: packageRoot,
      encoding: 'utf8',
    }).trim()
  );
} catch (err) {
  console.error(`Not a git checkout: ${err.message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

// '' when this package is the whole checkout, which is what keeps the script
// working in a single-package repo.
const packageDir = path.relative(repoRoot, packageRoot);

// The repo-relative directories this vitest project actually has tests for.
// api's `include` reaches ../cli/tests as well as its own: the CLI package has
// no vitest of its own and this suite is what runs its tests, so dropping cli/
// along with the other packages would silently under-run. Keep this in step
// with `include` in vitest.config.ts — naming one directory too many costs a
// "no tests" line, naming one too few costs a test that should have run.
const SIBLING_TEST_DIRS = ['cli'];

const testedDirs = [packageDir, ...SIBLING_TEST_DIRS].filter((dir) =>
  existsSync(path.join(repoRoot, dir))
);

function testedDirOf(file) {
  return testedDirs.find((dir) => dir === '' || file === dir || file.startsWith(`${dir}/`));
}

const base = process.argv[2] ?? 'origin/main';

let changed;
try {
  // Committed against the merge base, plus whatever is still uncommitted, so it
  // answers the same question before and after a commit. All three run from the
  // repo root: `git diff` reports repo-relative paths from anywhere, but
  // `git ls-files` reports them relative to cwd and lists only what is under it,
  // so run from api/ it would miss every untracked file in a sibling package.
  // `--relative` would fix the paths and hide the sibling packages in one step,
  // which is the silence this script exists to remove — and `git ls-files` does
  // not accept it at all.
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

// A hoisted package whose node_modules no .gitignore covers turns the untracked
// list into thousands of dependency .ts files; none of them is ever a source
// file of ours.
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git']);

const sources = [...new Set(changed)]
  .filter(
    (file) =>
      file.endsWith('.ts') &&
      !file.endsWith('.d.ts') &&
      !file.split('/').some((segment) => IGNORED_DIRS.has(segment))
  )
  .sort();

const inScope = [];
const skipped = new Map();
for (const file of sources) {
  if (testedDirOf(file) !== undefined) {
    inScope.push(file);
    continue;
  }
  const owner = file.includes('/') ? file.slice(0, file.indexOf('/')) : '.';
  skipped.set(owner, (skipped.get(owner) ?? 0) + 1);
}

function testHint(dir) {
  try {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8'));
    if (pkg.scripts?.test) return `pnpm -C ${dir} test`;
  } catch {
    // Not a package, or no package.json to read: no command worth suggesting.
  }
  return undefined;
}

const scope = testedDirs.map((dir) => `${dir || '.'}/`).join(' and ');

if (skipped.size > 0) {
  const total = [...skipped.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `Skipped ${String(total)} changed TypeScript file(s) outside ${scope}: this runs ` +
      `${packageDir || '.'}/'s vitest project, which has no tests for them.`
  );
  for (const [dir, count] of [...skipped].sort()) {
    const hint = dir === '.' ? undefined : testHint(dir);
    console.log(`  ${dir}/ (${String(count)})${hint === undefined ? '' : ` — run: ${hint}`}`);
  }
  console.log();
}

if (inScope.length === 0) {
  console.log(`No changed TypeScript files under ${scope} against ${base}; nothing to run.`);
  process.exit(0);
}

console.log(
  `Tests reaching ${String(inScope.length)} changed file(s) under ${scope} against ${base}:`
);
for (const file of inScope) {
  console.log(`  ${file}`);
}

const result = spawnSync(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'related',
    '--run',
    ...inScope.map((file) => path.relative(packageRoot, path.join(repoRoot, file))),
  ],
  { stdio: 'inherit', cwd: packageRoot }
);
process.exit(result.status ?? 1);
