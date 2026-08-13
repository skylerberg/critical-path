#!/usr/bin/env node
// Task-overlay check: mounts the ACTUAL TaskDetail.svelte (via
// scripts/task-detail-probe.html) in headless Chrome and asserts the things
// jsdom cannot model — where showModal() leaves the caret, and how many writes
// one title edit produces when the overlay is dismissed.
//
//   npm run check:task-detail
//   node scripts/check-task-detail.mjs --selftest
//
// Chromium deliberately, and not only because CI installs it: removing a focused
// input fires `blur` in Chromium and NOT in WebKit, so Chromium is the engine on
// which a dismissal runs both flush paths at once. The bug this guards was
// invisible on WebKit and invisible to jsdom, which fires no blur on unmount
// either.
//
// Boots vite in-process on the first free port at or above 5190 (override with
// TASK_DETAIL_PROBE_PORT — its own variable, not one shared with the layout
// probe check, so overriding one cannot land both on the same port), measures,
// tears down. Skips with exit 0 if Chromium isn't
// installed. Exits non-zero on assertion failure.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELFTEST = process.argv.includes('--selftest');

// Puts the component back on the bug: with the queue disabled every flush runs
// concurrently, which is exactly the state a $state-owned queue head degraded to
// while the component was being torn down.
let rewrites = 0;
const disableWriteQueue = {
  name: 'selftest-disable-write-queue',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('src/components/TaskDetail.svelte')) return null;
    const next = code.replace('pendingWrite.then(run)', 'Promise.resolve().then(run)');
    if (next === code) return null;
    rewrites += 1;
    return next;
  },
};

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  plugins: SELFTEST ? [disableWriteQueue] : [],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.TASK_DETAIL_PROBE_PORT ?? '5190'),
    strictPort: false,
  },
});
await server.listen();
const teardown = () => server.close();
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const PROBE = new URL('scripts/task-detail-probe.html', server.resolvedUrls.local[0]).href;

const browser = await createBrowser();
if (!browser) {
  console.warn('check:task-detail — skipped (Playwright Chromium not installed).');
  console.warn('  Run `npx playwright install chromium`.');
  await teardown();
  process.exit(0);
}

const TITLE_FIELD = 'dialog input[type="text"], dialog input:not([type])';

// Typed through the value setter and an input event, which is what the component
// listens to; assigning .value alone fires nothing and would measure a field the
// store never heard about.
const DISMISS_WITH_UNSAVED_TITLE = `(async () => {
  const input = document.querySelector('${TITLE_FIELD}');
  if (!input) return JSON.stringify({ found: false });
  input.focus();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    .call(input, 'Typed but never blurred');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  window.__requests.length = 0;
  const blurs = [];
  input.addEventListener('blur', () => blurs.push(1));
  window.__unmount();
  await new Promise((r) => setTimeout(r, 500));
  const patches = window.__requests.filter((r) => r.method === 'PATCH');
  return JSON.stringify({
    found: true,
    blurred: blurs.length > 0,
    patches: patches.length,
    titles: patches.map((p) => p.body.title),
    preconditions: patches.map((p) => p.body.expected_updated_at),
  });
})()`;

const ON_OPEN = `(() => {
  const dialog = document.querySelector('dialog');
  const field = document.querySelector('${TITLE_FIELD}');
  const active = document.activeElement;
  // Control for the negative below: a hand focus must actually move
  // activeElement, or "the caret is not in the title" proves only that nothing on
  // this page can take focus at all.
  let control = null;
  if (field) {
    field.focus();
    control = document.activeElement === field;
    field.blur();
  }
  return JSON.stringify({
    dialogOpen: dialog?.open ?? false,
    caretInTitle: field !== null && active === field,
    control,
  });
})()`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
}

await browser.setViewport({ width: 390, height: 844, mobile: true });
await browser.goto(PROBE, { wait: 700 });

const open = JSON.parse(await browser.eval(ON_OPEN));
check('the overlay opens as a modal', open.dialogOpen === true);
check('a hand focus moves activeElement (control)', open.control === true);
// The overlay put the caret in this field on every open for a month, invisibly to
// the tests, because showModal()'s focus steps only exist in a real browser.
check('opening does not put the caret in the title field', open.caretInTitle === false);

const dismissed = JSON.parse(await browser.eval(DISMISS_WITH_UNSAVED_TITLE));
check('the title field was found', dismissed.found === true);
// The teardown flush is the only thing that saves this on an engine that fires no
// blur, and both flush paths run on one that does.
check(
  'a dismissal with an unsaved title writes it',
  dismissed.titles?.[0] === 'Typed but never blurred',
  JSON.stringify(dismissed.titles)
);
check(
  'one edit is one write, however many flush paths the engine runs',
  dismissed.patches === 1,
  `${String(dismissed.patches)} PATCHes, preconditions ${JSON.stringify(dismissed.preconditions)}`
);

await browser.close();
await teardown();

console.log(`\ncheck:task-detail — task overlay (blur on unmount: ${String(dismissed.blurred)})`);
for (const { name, ok, detail } of results) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const failed = results.filter((r) => !r.ok);
if (SELFTEST) {
  // Rewriting none is the same failure the selftest exists to catch, wearing the
  // selftest's face: a check that passes because it measured a component the
  // transform never reached.
  if (rewrites !== 1) {
    console.error(
      `\ncheck:task-detail --selftest — FAILED: rewrote ${String(rewrites)} call sites, expected 1`
    );
    process.exit(1);
  }
  const expected = 'one edit is one write, however many flush paths the engine runs';
  if (!failed.some((r) => r.name === expected)) {
    console.error(
      `\ncheck:task-detail --selftest — FAILED: "${expected}" still passed with the write queue disabled`
    );
    process.exit(1);
  }
  console.log(
    '\ncheck:task-detail --selftest — passed (the check fails when the queue is disabled)'
  );
  process.exit(0);
}

if (failed.length > 0) {
  console.error(`\ncheck:task-detail — ${String(failed.length)} FAILED`);
  process.exit(1);
}
console.log('\ncheck:task-detail — passed');
