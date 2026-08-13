#!/usr/bin/env node
/**
 * The unit-test half of `--selftest`.
 *
 * The browser checks each re-run their cases against a component deliberately put
 * back on the bug, and fail if any of them still passes. Nothing did that for the
 * suite, so a unit test that asserts nothing — a stale expectation, a fixture that
 * no longer reaches the code path, an assertion that was already true before the
 * fix — reported green forever and the fix it was supposed to hold shut could be
 * deleted without a word.
 *
 * This puts each bug in `scripts/test-guards.mjs` back one at a time and requires
 * the named tests to FAIL. A guard whose tests still pass is reported: either the
 * mutation no longer reaches the bug, or the test never guarded it.
 *
 * Usage:
 *   node scripts/check-test-guards.mjs            # every guard
 *   node scripts/check-test-guards.mjs deleteColumn   # guards matching a substring
 *
 * The source tree is edited in place and restored in a `finally`, and again from
 * a SIGINT/SIGTERM handler, so a killed run does not leave a bug behind. It
 * refuses to start if any target file has uncommitted changes, because that
 * restore writes the file back to what it held at startup and there must be no
 * doubt about what that was.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { guards } from './test-guards.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2] ?? '';
const selected = filter
  ? guards.filter((guard) => guard.name.includes(filter) || guard.file.includes(filter))
  : guards;

if (selected.length === 0) {
  console.error(`check-test-guards — no guard matches ${JSON.stringify(filter)}`);
  process.exit(1);
}

const targets = [...new Set(selected.map((guard) => guard.file))];

// A restore writes back what the file held at startup, so anything uncommitted
// would be silently reverted to HEAD's content on the way out.
const dirty = spawnSync('git', ['status', '--porcelain', '--', ...targets], {
  cwd: repoRoot,
  encoding: 'utf8',
});
if (dirty.stdout.trim() !== '') {
  console.error('check-test-guards — refusing to run with uncommitted changes to:');
  console.error(dirty.stdout.trimEnd());
  console.error('\nCommit or stash them first; this check rewrites these files in place.');
  process.exit(1);
}

/** @type {Map<string, string>} */
const originals = new Map(
  targets.map((file) => [file, readFileSync(resolve(repoRoot, file), 'utf8')])
);

function restoreAll() {
  for (const [file, contents] of originals) {
    writeFileSync(resolve(repoRoot, file), contents);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restoreAll();
    process.exit(130);
  });
}

/** Runs the guard's tests and answers whether they passed. */
function testsPass(tests) {
  const result = spawnSync('npx', ['vitest', 'run', ...tests], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  return result.status === 0;
}

const failures = [];

try {
  for (const guard of selected) {
    const path = resolve(repoRoot, guard.file);
    const original = originals.get(guard.file);

    // Exactly once, never "at least once": a pattern that matches nothing leaves
    // the source correct and the tests green, which reads exactly like a guard
    // that works. One that matches twice rewrites a line nobody chose.
    const occurrences = original.split(guard.find).length - 1;
    if (occurrences !== 1) {
      failures.push(
        `${guard.name}\n    its \`find\` matched ${occurrences}x in ${guard.file} (must be exactly 1) — ` +
          `the guard is stale, not the code`
      );
      console.log(`  ✗ ${guard.name} — find matched ${occurrences}x, expected 1`);
      continue;
    }

    writeFileSync(path, original.replace(guard.find, guard.replace));
    const stillPassing = testsPass(guard.tests);
    writeFileSync(path, original);

    if (stillPassing) {
      failures.push(
        `${guard.name}\n    ${guard.tests.join(' ')} still passed with the bug put back in ${guard.file}`
      );
      console.log(`  ✗ ${guard.name}`);
    } else {
      console.log(`  ✓ ${guard.name}`);
    }
  }
} finally {
  restoreAll();
}

if (failures.length > 0) {
  console.error(`\ncheck-test-guards — ${failures.length} guard(s) did not catch their bug:\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`\ncheck-test-guards — ${selected.length} guard(s) caught their bug.`);
