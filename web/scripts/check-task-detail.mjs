#!/usr/bin/env node
// Task-overlay check: mounts the ACTUAL TaskDetail.svelte (via
// scripts/task-detail-probe.html) in headless Chrome and asserts the things
// jsdom cannot model — where showModal() leaves the caret, and how many writes
// one edit produces, to which card, when the overlay is dismissed or moved to
// another card with text still unsaved in either field.
//
//   pnpm run check:task-detail
//   node scripts/check-task-detail.mjs --selftest
//
// Chromium deliberately, and not only because CI installs it: removing a focused
// input fires `blur` in Chromium and NOT in WebKit, so Chromium is the engine on
// which a dismissal runs both flush paths at once. The bug this guards was
// invisible on WebKit and invisible to jsdom, which fires no blur on unmount
// either.
//
// Each destructive arm gets its own page load, because unmounting the overlay
// and switching the card it holds are both one-way: measuring the next arm on
// the leftovers of the last one would grade a component nobody is looking at.
//
// Boots vite in-process on the first free port at or above 5190 (override with
// TASK_DETAIL_PROBE_PORT), measures, tears down. Skips with exit 0 if Chromium
// isn't installed. Exits non-zero on assertion failure.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELFTEST = process.argv.includes('--selftest');

// Puts the component back on two bugs, one per arm that has to be earned.
//
// With the queue disabled every flush runs concurrently, which is exactly the
// state a $state-owned queue head degraded to while the component was being torn
// down. With the live re-read back in saveDescription, the editor's teardown
// flush measures the card that has already replaced the one it belongs to, and
// the text is dropped rather than written.
const MUTATIONS = [
  {
    what: 'the write queue',
    find: 'pendingWrite.then(run)',
    replace: 'Promise.resolve().then(run)',
    breaks: 'one edit is one write, however many flush paths the engine runs',
  },
  {
    what: "saveDescription's card identity",
    find: 'if (conflictDrafts.get(open.id) !== null || open.removing) return true;',
    replace:
      'if (conflictDrafts.get(open.id) !== null || open.removing || open.id !== taskId) return true;',
    breaks: 'a switch writes the unsaved description to the card it was typed on',
  },
];
const rewrites = new Map(MUTATIONS.map(({ what }) => [what, 0]));
const restoreBugs = {
  name: 'selftest-restore-card-write-bugs',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('src/components/TaskDetail.svelte')) return null;
    let next = code;
    for (const mutation of MUTATIONS) {
      // Counted by occurrence, not by "the code changed": a string pattern
      // rewrites only the first match, so a second occurrence would be left on
      // the fixed code while the tally below still read 1.
      const hits = next.split(mutation.find).length - 1;
      if (hits === 0) continue;
      rewrites.set(mutation.what, rewrites.get(mutation.what) + hits);
      next = next.replaceAll(mutation.find, () => mutation.replace);
    }
    return next === code ? null : next;
  },
};

const server = await createServer({
  root: ROOT,
  logLevel: 'warn',
  plugins: SELFTEST ? [restoreBugs] : [],
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
  console.warn('  Run `pnpm exec playwright install chromium`.');
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

// Typed through tiptap's own command, the seam the unit tests already use: the
// editor owns a document, not the DOM, and writing to the contenteditable by hand
// measures a document ProseMirror never heard about.
const TYPE_UNSAVED_DESCRIPTION = `
  const dom = document.querySelector('.tiptap');
  if (!dom || !dom.editor) return JSON.stringify({ found: false });
  dom.focus();
  dom.editor.commands.insertContent(' and unsaved words');
  await new Promise((r) => setTimeout(r, 80));
  window.__requests.length = 0;`;

const SWITCH_WITH_UNSAVED_DESCRIPTION = `(async () => {
  ${TYPE_UNSAVED_DESCRIPTION}
  const [first, second] = window.__fixture;
  window.__switch(second.id);
  await new Promise((r) => setTimeout(r, 600));
  const patches = window.__requests.filter((r) => r.method === 'PATCH');
  return JSON.stringify({
    found: true,
    patches: patches.length,
    paths: patches.map((p) => p.path),
    wanted: '/api/tasks/' + first.id,
    texts: patches.map((p) => JSON.stringify(p.body.description ?? null)),
    preconditions: patches.map((p) => p.body.expected_updated_at),
    base: first.updated_at,
  });
})()`;

const DISMISS_WITH_UNSAVED_DESCRIPTION = `(async () => {
  ${TYPE_UNSAVED_DESCRIPTION}
  const blurs = [];
  dom.addEventListener('blur', () => blurs.push(1));
  window.__unmount();
  await new Promise((r) => setTimeout(r, 500));
  const patches = window.__requests.filter((r) => r.method === 'PATCH');
  return JSON.stringify({
    found: true,
    blurred: blurs.length > 0,
    patches: patches.length,
    texts: patches.map((p) => JSON.stringify(p.body.description ?? null)),
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

// Readiness is polled, not waited out. Vite re-optimizes dependencies on a cold
// load and reloads the page after its own load event, so a fixed delay can land
// on a page with nothing mounted — and then every arm reports `undefined` while
// the run still reads as a run, which for --selftest is a pass for the wrong
// reason. Observed here: the first arm of a run measured an empty page while the
// two after a reload measured a real one.
const MOUNTED = `Boolean(document.querySelector('dialog')?.open) &&
  document.querySelector('.tiptap')?.editor !== undefined`;

async function openProbe() {
  await browser.goto(PROBE, { wait: 300 });
  for (let poll = 0; poll < 60; poll += 1) {
    if (await browser.eval(MOUNTED)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Infrastructure, not an assertion: nothing was measured, so reporting it
  // among the arms would file it as a component that behaved badly.
  console.error('\ncheck:task-detail — FAILED: the overlay never mounted at %s', PROBE);
  await browser.close();
  await teardown();
  process.exit(1);
}

await browser.setViewport({ width: 390, height: 844, mobile: true });
await openProbe();

const open = JSON.parse(await browser.eval(ON_OPEN));
check('the overlay opens as a modal', open.dialogOpen === true);
check('a hand focus moves activeElement (control)', open.control === true);
// The overlay put the caret in this field on every open for a month, invisibly to
// the tests, because showModal()'s focus steps only exist in a real browser.
check('opening does not put the caret in the title field', open.caretInTitle === false);

// The overlay is reused between cards, so this teardown runs with the next card's
// id already live. Reading it there is what dropped the text outright — and
// reading it one line later is what would have sent it to the wrong card.
const switched = JSON.parse(await browser.eval(SWITCH_WITH_UNSAVED_DESCRIPTION));
check('the description editor was found', switched.found === true);
check(
  'a switch writes the unsaved description to the card it was typed on',
  switched.patches === 1 && switched.paths?.[0] === switched.wanted,
  `${String(switched.patches)} PATCHes to ${JSON.stringify(switched.paths)}, wanted ${String(switched.wanted)}`
);
// Guarded on `found`, not only on the two values agreeing: undefined equals
// undefined, and an arm that measured nothing would otherwise report this green.
check(
  'and against the version that card was loaded at',
  switched.found === true && switched.preconditions?.[0] === switched.base,
  `${JSON.stringify(switched.preconditions)}, wanted ${String(switched.base)}`
);

await openProbe();
const dismissedDescription = JSON.parse(await browser.eval(DISMISS_WITH_UNSAVED_DESCRIPTION));
check(
  // The seeded half is asserted too: an editor the net stub had emptied would
  // still carry the typed words, so this arm would pass against the very
  // fixture erasure the probe's detail read exists to prevent.
  'a dismissal with an unsaved description writes it, onto what was there',
  dismissedDescription.texts?.[0]?.includes('and unsaved words') === true &&
    dismissedDescription.texts?.[0]?.includes('Stored description') === true,
  JSON.stringify(dismissedDescription.texts)
);
check(
  'one description edit is one write, blur at unmount included',
  dismissedDescription.patches === 1,
  `${String(dismissedDescription.patches)} PATCHes`
);

await openProbe();
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
  for (const { what, breaks } of MUTATIONS) {
    // Rewriting none is the same failure the selftest exists to catch, wearing the
    // selftest's face: a check that passes because it measured a component the
    // transform never reached.
    const applied = rewrites.get(what);
    if (applied !== 1) {
      console.error(
        `\ncheck:task-detail --selftest — FAILED: rewrote ${String(applied)} call sites for ${what}, expected 1`
      );
      process.exit(1);
    }
    if (!failed.some((r) => r.name === breaks)) {
      console.error(
        `\ncheck:task-detail --selftest — FAILED: "${breaks}" still passed with ${what} put back on its bug`
      );
      process.exit(1);
    }
  }
  console.log(
    `\ncheck:task-detail --selftest — passed (${String(MUTATIONS.length)} restored bugs, each caught by the arm that names it)`
  );
  process.exit(0);
}

if (failed.length > 0) {
  console.error(`\ncheck:task-detail — ${String(failed.length)} FAILED`);
  process.exit(1);
}
console.log('\ncheck:task-detail — passed');
