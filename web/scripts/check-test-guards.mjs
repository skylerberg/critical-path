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
 *   node scripts/check-test-guards.mjs --verify-only   # anchors only, no test run
 *   node scripts/check-test-guards.mjs --selftest      # prove the runner still bites
 *
 * The source tree is never written. Each guard is one spawned `vitest` child
 * carrying its edit in `GUARD_MUTATION`, which `guardMutation()` in
 * `vite.config.ts` applies as the module is transformed — so a run cannot leave a
 * bug behind, cannot corrupt what another process is reading, and is affordable
 * in CI. Children run `GUARD_CONCURRENCY` at a time, each with its own
 * dep-optimizer cache and its own marker file under a single temp directory.
 *
 * Five verdicts, of which one is a pass:
 *
 *   CAUGHT         the mutation reached the module and the tests failed.
 *   STILL-PASSED   it reached the module and the tests passed — the guard is dead.
 *   NO-TESTS-RAN   `testName` selected nothing, or the mutation stopped the file
 *                  compiling. Inconclusive, which is not a pass.
 *   NEVER-APPLIED  the tests ran but the module was never transformed, so nothing
 *                  the guard names was ever in play.
 *   RUN-FAILED     the child died before printing a summary. That is
 *                  infrastructure, and it is kept apart from NEVER-APPLIED
 *                  because reporting it as one sends the reader to a stale anchor
 *                  that is fine.
 *
 * `--verify-only` is the sub-second half: it checks that every `find` still
 * matches its file exactly once and stops there, which is the answer to "did my
 * refactor just orphan a guard" without paying for the suite.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { guards } from './test-guards.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const selftest = args.includes('--selftest');
const filter = args.find((arg) => !arg.startsWith('--')) ?? '';
// Four is where wall time stops improving: past it the children mostly compete
// with each other's own internal parallelism, doubling total CPU for seconds.
const concurrency = Number.parseInt(process.env.GUARD_CONCURRENCY ?? '', 10) || 4;

/** @param {string} name */
function guardNamed(name) {
  const guard = guards.find((entry) => entry.name === name);
  if (guard === undefined) {
    throw new Error(`check-test-guards --selftest names a guard that no longer exists: ${name}`);
  }
  return guard;
}

/**
 * A guard whose edit rewrites its anchor to itself. Applied, and inert — which
 * is what a guard that has stopped guarding anything looks like from here.
 *
 * @param {string} name
 * @param {string} label
 */
function deadGuard(name, label) {
  const guard = guardNamed(name);
  return { ...guard, name: label, replace: guard.find };
}

/**
 * The controls that earn the right to believe a green run: one real guard this
 * runner must still report as caught, and three it must NOT, each with the
 * verdict it has to reach instead.
 *
 * The first is what a pipeline that has stopped mutating at all fails — a
 * plugin that still touches the marker but hands back the code unchanged makes
 * every guard inert, and the three negative controls are all satisfied by
 * exactly that. The last is the one the marker file exists for: a real mutation
 * aimed at a module the named tests never load, where the tests pass because
 * the bug was never in play rather than because nothing guards it.
 */
const controls = selftest
  ? [
      {
        expect: 'CAUGHT',
        guard: {
          ...guardNamed('only the states that mean it say "Offline"'),
          name: 'control: a guard that must still bite',
        },
      },
      {
        expect: 'STILL-PASSED',
        guard: deadGuard(
          'only the states that mean it say "Offline"',
          'control: a mutation that rewrites its own anchor'
        ),
      },
      {
        expect: 'STILL-PASSED',
        guard: deadGuard(
          'the reachability seed lowers but never raises',
          'control: a second mutation that rewrites its own anchor'
        ),
      },
      {
        expect: 'NEVER-APPLIED',
        guard: {
          ...guardNamed('one remote blocker of two expanded hosts is one node'),
          name: 'control: a mutation the named tests never load',
          tests: ['src/lib/sync-state.test.ts'],
          testName: 'never calls a state offline that only happens while the server answers',
        },
      },
    ]
  : [];

const selected = filter
  ? guards.filter((guard) => guard.name.includes(filter) || guard.file.includes(filter))
  : guards;

if (!selftest && selected.length === 0) {
  console.error(`check-test-guards — no guard matches ${JSON.stringify(filter)}`);
  process.exit(1);
}

const cases = selftest ? controls : selected.map((guard) => ({ guard, expect: 'CAUGHT' }));

/** @type {Map<string, string>} */
const sources = new Map();

/** @param {string} file */
function sourceOf(file) {
  const cached = sources.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const contents = readFileSync(resolve(repoRoot, file), 'utf8');
  sources.set(file, contents);
  return contents;
}

/** @type {Set<import('node:child_process').ChildProcess>} */
const children = new Set();

/**
 * Runs one guard's tests with its edit in the environment.
 *
 * `testName` narrows to the cases that actually guard this bug. Without it a
 * guard re-runs its whole file, which is both slower and looser: the run only has
 * to fail *somewhere* to count, so an unrelated broken test in the same file
 * would report the guard as working.
 *
 * `detached` puts each child in its own process group so a cancelled run can
 * take the whole tree down by group: `npx` forwards nothing to the vitest it
 * spawned, and vitest's own workers are another generation below that.
 *
 * @param {{file: string, find: string, replace: string, tests: string[], testName?: string}} guard
 * @param {string} jobDir
 */
function runGuard(guard, jobDir) {
  mkdirSync(jobDir, { recursive: true });
  const marker = join(jobDir, 'applied');
  const child = spawn(
    'npx',
    [
      'vitest',
      'run',
      ...guard.tests,
      ...(guard.testName === undefined ? [] : ['-t', guard.testName]),
    ],
    {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        CI: '1',
        GUARD_MUTATION: JSON.stringify({
          file: guard.file,
          find: guard.find,
          replace: guard.replace,
        }),
        GUARD_APPLIED_MARKER: marker,
        GUARD_CACHE_DIR: join(jobDir, 'vite'),
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
    }
  );
  children.add(child);
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  return new Promise((settle) => {
    // Without this, a spawn that fails outright throws out of the pool instead of
    // reaching the verdict added for a child that died before measuring anything.
    child.on('error', (error) => (output += String(error)));
    child.on('close', (status) => {
      children.delete(child);
      // Whether anything actually ran is read from the summary rather than from
      // the exit code, because the exit code cannot tell "no tests" from "tests
      // passed": a `-t` matching nothing skips every case and exits 0.
      //
      // Read off a decolored copy. The child is asked for plain output below, but
      // a summary line that arrives styled begins with an escape rather than
      // whitespace, and every guard then reports NO-TESTS-RAN while genuinely
      // catching its bug — which is how this passed every local run and failed
      // all twelve on a runner that advertises color.
      const summary = /^\s*Tests\s+(.*)$/m.exec(decolor(output))?.[1] ?? '';
      settle({
        applied: existsSync(marker),
        ran: /\d+ (passed|failed)/.test(summary),
        passed: status === 0,
        output,
      });
    });
  });
}

/** @param {{applied: boolean, ran: boolean, passed: boolean}} run */
function verdictOf({ applied, ran, passed }) {
  if (!applied) {
    return ran ? 'NEVER-APPLIED' : 'RUN-FAILED';
  }
  if (!ran) {
    return 'NO-TESTS-RAN';
  }
  return passed ? 'STILL-PASSED' : 'CAUGHT';
}

/** @param {string} output */
/** Styling a child emitted anyway, so neither the parse nor the log has to wear it. */
function decolor(output) {
  // The escape is the point: matching it is what this function is for.
  // eslint-disable-next-line no-control-regex
  return output.replaceAll(/\u001b\[[0-9;]*m/g, '');
}

function tail(output) {
  return decolor(output)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-6)
    .map((line) => `      ${line}`)
    .join('\n');
}

/**
 * @param {{name: string, file: string, tests: string[]}} guard
 * @param {string} verdict
 * @param {string} output
 */
function explain(guard, verdict, output) {
  switch (verdict) {
    case 'STILL-PASSED':
      return `${guard.tests.join(' ')} still passed with the bug put back in ${guard.file}`;
    case 'NO-TESTS-RAN':
      return (
        `no test actually ran in ${guard.tests.join(' ')} — either its \`testName\` matches ` +
        `nothing, or the mutation stopped the file compiling. Inconclusive, which is not a ` +
        `pass:\n${tail(output)}`
      );
    case 'NEVER-APPLIED':
      return (
        `the tests ran, but ${guard.file} was never transformed — nothing in ` +
        `${guard.tests.join(' ')} imports it, so the bug was never in play`
      );
    default:
      return `vitest never printed a summary, so this run measured nothing:\n${tail(output)}`;
  }
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T, index: number) => Promise<R>} run
 * @returns {Promise<R[]>}
 */
async function pool(items, limit, run) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}

const failures = [];
const runnable = [];

for (const entry of cases) {
  const { guard } = entry;

  // Exactly once, never "at least once": a pattern that matches nothing leaves
  // the source correct and the tests green, which reads exactly like a guard
  // that works. One that matches twice rewrites a line nobody chose.
  const occurrences = sourceOf(guard.file).split(guard.find).length - 1;
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

  runnable.push(entry);
}

if (runnable.length > 0) {
  const dir = mkdtempSync(join(tmpdir(), 'check-test-guards-'));
  // A signal skips the `finally`, so without this a Ctrl-C or a cancelled CI job
  // leaves tens of megabytes of per-job dep-optimizer cache in $TMPDIR that
  // nothing ever reclaims — and leaves the children writing into it after the
  // process that owns it is gone.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      for (const child of children) {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {
            child.kill();
          }
        }
      }
      rmSync(dir, { recursive: true, force: true });
      process.exit(130);
    });
  }
  try {
    const results = await pool(runnable, concurrency, async ({ guard, expect }, index) => {
      const run = await runGuard(guard, join(dir, `job-${index}`));
      const verdict = verdictOf(run);
      const mark = verdict === expect ? '✓' : '✗';
      console.log(
        verdict === expect && !selftest
          ? `  ${mark} ${guard.name}`
          : `  ${mark} ${guard.name} — ${verdict}`
      );
      return { guard, expect, verdict, output: run.output };
    });

    for (const { guard, expect, verdict, output } of results) {
      if (verdict === expect) {
        continue;
      }
      failures.push(
        selftest
          ? `${guard.name}\n    expected ${expect}, got ${verdict} — this runner can no longer ` +
              `tell a guard that bites from one that does not`
          : `${guard.name}\n    ${explain(guard, verdict, output)}`
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  const what = verifyOnly
    ? 'is no longer anchored'
    : selftest
      ? 'came out the wrong way'
      : 'did not catch their bug';
  console.error(`\ncheck-test-guards — ${failures.length} guard(s) ${what}:\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(
  verifyOnly
    ? `\ncheck-test-guards — ${cases.length} guard(s) still anchored. ` +
        'Run without --verify-only to prove they still catch anything.'
    : selftest
      ? `\ncheck-test-guards --selftest — ${cases.length} control(s) reached the verdict they were built for.`
      : `\ncheck-test-guards — ${cases.length} guard(s) caught their bug.`
);
