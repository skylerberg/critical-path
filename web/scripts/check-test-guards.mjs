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
 *   node scripts/check-test-guards.mjs                 # every guard
 *   node scripts/check-test-guards.mjs deleteColumn    # guards matching a substring
 *   node scripts/check-test-guards.mjs --verify-only   # anchors only, no mutation
 *
 * The source tree is edited in place and restored in a `finally`, and again from
 * a SIGINT/SIGTERM handler, so a killed run does not leave a bug behind. It
 * refuses to start if any target file has uncommitted changes, because that
 * restore writes the file back to what it held at startup and there must be no
 * doubt about what that was.
 *
 * `--verify-only` is the half that is cheap and safe enough for CI: it checks
 * that every `find` still matches its file exactly once and stops there — no
 * mutation, no test run, no dirty-tree refusal, so it is also the quick local
 * answer to "did my refactor just orphan a guard". A guard whose anchor has
 * drifted is the likeliest way this whole check rots, and it is the one failure
 * that costs nothing to catch. Proving each guard still *catches* its bug needs
 * the mutation, which is why the full run stays manual, exactly like the
 * `--selftest` flags on the browser checks.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { guards } from './test-guards.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const filter = args.find((arg) => !arg.startsWith('--')) ?? '';
const selected = filter
  ? guards.filter((guard) => guard.name.includes(filter) || guard.file.includes(filter))
  : guards;

if (selected.length === 0) {
  console.error(`check-test-guards — no guard matches ${JSON.stringify(filter)}`);
  process.exit(1);
}

const targets = [...new Set(selected.map((guard) => guard.file))];

// A restore writes back what the file held at startup, so anything uncommitted
// would be silently reverted to HEAD's content on the way out. --verify-only
// writes nothing, so it has nothing to protect and runs on a dirty tree.
if (!verifyOnly) {
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

/**
 * Runs the guard's tests and answers whether they passed.
 *
 * `testName` narrows to the cases that actually guard this bug. Without it a
 * guard re-runs its whole file, which is both slower and looser: the run only has
 * to fail *somewhere* to count, so an unrelated broken test in the same file
 * would report the guard as working.
 */
function testsPass({ tests, testName }) {
  const result = spawnSync(
    'npx',
    ['vitest', 'run', ...tests, ...(testName === undefined ? [] : ['-t', testName])],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, CI: '1' } }
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // Whether anything actually ran, read from the summary rather than from the
  // exit code, because the exit code cannot tell "no tests" from "tests passed":
  // a `-t` matching nothing skips every case and exits 0. That lands in the
  // "still passed" branch, which is the right verdict for the wrong reason — and
  // a vitest that exited non-zero instead would land in the branch that reports
  // the guard as WORKING, which is the direction that loses information.
  //
  // A mutation that stops the file compiling produces the same nothing-ran
  // summary, and is equally inconclusive: the run fails because nothing built,
  // not because the guard bit.
  const summary = /^\s*Tests\s+(.*)$/m.exec(output)?.[1] ?? '';
  return { passed: result.status === 0, ran: /\d+ (passed|failed)/.test(summary) };
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

    if (verifyOnly) {
      console.log(`  ✓ ${guard.name} — anchored`);
      continue;
    }

    writeFileSync(path, original.replace(guard.find, guard.replace));
    const { passed: stillPassing, ran } = testsPass(guard);
    writeFileSync(path, original);

    if (!ran) {
      failures.push(
        `${guard.name}\n    no test actually ran in ${guard.tests.join(' ')} — either its ` +
          `\`testName\` matches nothing, or the mutation stopped the file compiling. ` +
          `Inconclusive, which is not a pass`
      );
      console.log(`  ✗ ${guard.name} — no tests ran`);
      continue;
    }

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
  const what = verifyOnly ? 'is no longer anchored' : 'did not catch their bug';
  console.error(`\ncheck-test-guards — ${failures.length} guard(s) ${what}:\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  verifyOnly
    ? `\ncheck-test-guards — ${selected.length} guard(s) still anchored. ` +
        'Run without --verify-only to prove they still catch anything.'
    : `\ncheck-test-guards — ${selected.length} guard(s) caught their bug.`
);
