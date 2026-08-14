#!/usr/bin/env node
// Column-menu check: drives the REAL ColumnHeader.svelte inside the real
// Board.svelte (via scripts/board-probe.html) in headless Chrome, opens a
// column's kebab, expands "Sort by", picks an option, and reads the resulting
// card order off the rendered DOM.
//
//   npm run check:column-menu
//   node scripts/check-column-menu.mjs --selftest
//
// It exists because the tier below it cannot answer the question. The component
// test opens the same submenu and asserts board.sortColumn was called with the
// right option — which proves a handler fired and nothing about whether the
// column re-orders, or whether the menu is still on screen to be clicked at all.
// A reported "the Sort by menu just closes" sits entirely in that gap: the item
// is one state flag away from dismissing the menu it is supposed to expand, and
// every layer under a browser reports that as a passing call.
//
// So each arm reads a rendered consequence. The order is compared against the
// order the same titles sort into, taken from the DOM before the click, and the
// request is compared against that order too — an assertion about the request
// alone would be the same spy-shaped mistake one tier down.
//
// The order is read TWICE, and the first read is the load-bearing one. The probe
// answers the reorder with the caller's own ids, and the store re-stamps from
// that answer, so a column ordered only by the response renders exactly what an
// optimistically ordered one renders: read after the answer, "the cards moved"
// is implied by "the right request went out" and adds nothing to it. The probe
// therefore holds the answer back, and the first read happens inside that
// window, where a sort that sends the request and leaves the cards where they
// were is still distinguishable.
//
// Presses are full pointer sequences (pointerdown/mousedown/focus/pointerup/
// mouseup/click), not element.click(): the menu dismisses itself from a window
// click handler that inspects the event target, so which events fire and what
// they carry is the mechanism under test.
//
// Chromium only, matching the other browser checks — CI installs no other engine.
// Boots vite in-process on the first free port at or above 5210 (override with
// COLUMN_MENU_PROBE_PORT), measures, tears down. Skips with exit 0 if Chromium
// isn't installed. Exits non-zero on assertion failure.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SELFTEST = process.argv.includes('--selftest');

// The board probe's first column. Twelve cards whose titles sort into an order
// the board does not already have — "Task 10" before "Task 2" — which is what
// makes a no-op sort distinguishable from a sort.
const COLUMN = 'c0';
const CASES = '?cols=3&tasks=12';

async function startServer(plugins = []) {
  const created = await createServer({
    root: ROOT,
    logLevel: 'warn',
    // Its own optimizer cache, for the reason scripts/check-a11y.mjs keeps one:
    // node_modules is a symlink shared by every worktree, so the default cache is
    // one directory that concurrent vite servers pre-bundle into on top of each
    // other.
    cacheDir: 'node_modules/.vite-check-column-menu',
    plugins,
    server: {
      host: '127.0.0.1',
      port: Number(process.env.COLUMN_MENU_PROBE_PORT ?? '5210'),
      strictPort: false,
    },
  });
  await created.listen();
  return created;
}

// Shared prelude for both page scripts. String concatenation rather than
// template literals throughout, so nothing in here collides with the `${}` of
// the driver that embeds it.
const HARNESS = `
  const settled = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const column = document.querySelector('[data-column-id="${COLUMN}"]');
  // The trigger, not the popup: both carry this label, and once the menu is open
  // its "Sort by" row claims aria-haspopup="menu" as well.
  const kebab = column && column.querySelector('button[aria-label^="Options for"]');
  const menu = () => column && column.querySelector('[role="menu"]');
  const rows = () => (menu() ? [...menu().querySelectorAll('[role^="menuitem"]')] : []);
  const item = (label) => rows().find((el) => el.textContent.trim() === label) ?? null;
  const labels = () => rows().map((el) => el.textContent.trim());
  const cards = () =>
    [...column.querySelectorAll('[data-task-id]')].map((el) => ({
      id: el.dataset.taskId,
      title: (el.querySelector('a[aria-label]') || el).getAttribute('aria-label') || '',
    }));

  // What a finger or a mouse actually delivers. element.click() fires the last of
  // these six and nothing before it, which is enough to reach an onclick and not
  // enough to reach anything guarding on the press.
  const press = async (el) => {
    const r = el.getBoundingClientRect();
    const at = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: Math.round(r.left + r.width / 2),
      clientY: Math.round(r.top + r.height / 2),
      button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true,
    };
    el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, at, { buttons: 1 })));
    el.dispatchEvent(new MouseEvent('mousedown', Object.assign({}, at, { buttons: 1 })));
    // preventScroll, because the header sits in the board's horizontal scroller
    // and a focus that pans it would move every rect measured after this one.
    el.focus({ preventScroll: true });
    // The press and the release are separate turns of the event loop in life, so
    // anything the press schedules has run by the time the click lands.
    await settled();
    el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, at, { buttons: 0 })));
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, at, { buttons: 0 })));
    el.dispatchEvent(new MouseEvent('click', Object.assign({}, at, { buttons: 0, detail: 1 })));
    await settled();
  };
`;

// The control arm's own page load: it leaves a confirmation modal open, and an
// open <dialog> makes everything outside it inert.
const CLOSES_ON_ANOTHER_ITEM = `(async () => {
  ${HARNESS}
  if (!kebab) return JSON.stringify({ found: false });
  await press(kebab);
  const opened = menu() !== null;
  const expanded = kebab.getAttribute('aria-expanded');
  const other = item('Archive all cards');
  if (!other) return JSON.stringify({ found: true, opened, expanded, items: labels() });
  await press(other);
  return JSON.stringify({
    found: true,
    opened,
    expanded,
    otherFound: true,
    closed: menu() === null,
  });
})()`;

const SORT_A_COLUMN = `(async () => {
  ${HARNESS}
  // The store applies its optimistic order before it sends anything, so every
  // arm below is satisfied by a sort that then died reading the response — which
  // is exactly what a stubbed server echoing the request body produces. Nothing
  // catches the rejection of a void-called mutation, so it surfaces here.
  const thrown = [];
  addEventListener('error', (e) => thrown.push(String(e.message)));
  addEventListener('unhandledrejection', (e) =>
    thrown.push(String((e.reason && e.reason.message) || e.reason))
  );
  if (!kebab) return JSON.stringify({ found: false });
  const before = cards();
  // The order the store is about to compute, derived from the same titles by the
  // same comparison — so the expectation cannot drift from the seed data.
  const wanted = [...before].sort((a, b) => a.title.localeCompare(b.title)).map((c) => c.id);

  await press(kebab);
  const opened = menu() !== null;
  const sortBy = item('Sort by');
  if (!sortBy) return JSON.stringify({ found: true, opened, items: labels() });

  await press(sortBy);
  const stillOpen = menu() !== null;
  const submenu = labels();
  const option = item('Alphabetically');
  if (!option) {
    return JSON.stringify({
      found: true, opened, stillOpen, submenu,
      before: before.map((c) => c.id), wanted,
    });
  }

  window.__requests.length = 0;
  window.__answered.reorders = 0;
  await press(option);
  // press() ends two animation frames after the click, and the probe holds the
  // reorder response for longer than that, so this is the column as the store
  // left it with nothing back from the server yet — which the counter, read in
  // the same turn, is what actually establishes.
  const optimistic = cards().map((c) => c.id);
  const answeredAtRead = window.__answered.reorders;
  await pause(500);
  await settled();

  const reorders = window.__requests.filter(
    (r) => r.method === 'POST' && r.path === '/api/columns/${COLUMN}/reorder'
  );
  return JSON.stringify({
    found: true, opened, stillOpen, submenu, optionFound: true, thrown,
    before: before.map((c) => c.id),
    wanted,
    optimistic,
    answeredAtRead,
    after: cards().map((c) => c.id),
    sent: reorders.map((r) => (r.body && r.body.task_ids) || null),
    other: window.__requests
      .filter((r) => !reorders.includes(r))
      .map((r) => r.method + ' ' + r.path),
  });
})()`;

const browser = await createBrowser();
if (!browser) {
  console.warn('check:column-menu — skipped (Playwright Chromium not installed).');
  console.warn('  Run `npm run playwright:install`.');
  process.exit(0);
}
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// Vite re-optimizes dependencies on a cold load and reloads the page after its
// own load event, so a fixed delay can land on a board that has not mounted —
// and then every arm reports `undefined` while the run still reads as a run.
const MOUNTED = `Boolean(document.querySelector('[data-column-id="${COLUMN}"] [data-task-id]'))`;

// Each arm group gets its own page load: the control leaves a confirmation modal
// on screen and the sort is one-way, so measuring one on the leftovers of the
// other would grade a board nobody is looking at.
async function open(probeUrl) {
  await browser.setViewport({ width: 1280, height: 900, mobile: false });
  await browser.goto(probeUrl + CASES, { wait: 300 });
  for (let poll = 0; poll < 60; poll += 1) {
    if (await browser.eval(MOUNTED)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Infrastructure, not a verdict on the component: nothing was measured, so
  // filing it among the arms would report a board that behaved badly.
  console.error('check:column-menu — FAILED: the board never mounted at %s', probeUrl);
  await browser.close();
  process.exit(1);
}

/**
 * Every arm, against one dev server. Returns `{ name, ok, detail }` per arm; the
 * name is what the selftest below matches on.
 */
async function runArms(probeUrl) {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });

  await open(probeUrl);
  const control = JSON.parse(await browser.eval(CLOSES_ON_ANOTHER_ITEM));
  check(
    'the kebab opens the column menu',
    control.opened === true && control.expanded === 'true',
    `menu=${String(control.opened)} aria-expanded=${String(control.expanded)}`
  );
  // Without this, "the menu stayed open after Sort by" is also what a press that
  // never landed looks like.
  check(
    'another menu item closes the menu (control)',
    control.otherFound === true && control.closed === true,
    control.otherFound === true
      ? 'the menu was still on screen after "Archive all cards"'
      : `no "Archive all cards" row among ${JSON.stringify(control.items)}`
  );

  await open(probeUrl);
  const sort = JSON.parse(await browser.eval(SORT_A_COLUMN));
  // The reported symptom, and the reason this file exists.
  check(
    'Sort by expands the sort options and leaves the menu open',
    sort.stillOpen === true && (sort.submenu ?? []).includes('Alphabetically'),
    `menu ${sort.stillOpen === true ? 'open' : 'closed'}, rows ${JSON.stringify(sort.submenu ?? sort.items)}`
  );
  // Without this a column that was already alphabetical would let a sort that
  // does nothing at all pass the arm below.
  check(
    'the column is not already in the sorted order (control)',
    Array.isArray(sort.before) && sort.before.join() !== sort.wanted.join(),
    `${String(sort.before?.length)} cards`
  );
  // The only arm a sort that sends the right request and moves nothing can fail:
  // the probe is still holding the response, so this order is the store's own.
  check(
    'the cards move before the server answers',
    sort.optionFound === true &&
      sort.answeredAtRead === 0 &&
      sort.optimistic?.join() === sort.wanted.join(),
    sort.optionFound !== true
      ? 'the option row was never reached'
      : sort.answeredAtRead !== 0
        ? `the reorder was already answered ${String(sort.answeredAtRead)}x when the order was read`
        : `got ${JSON.stringify(sort.optimistic)}, wanted ${JSON.stringify(sort.wanted)}`
  );
  check(
    'choosing a sort option re-orders the cards on screen',
    sort.optionFound === true && sort.after?.join() === sort.wanted.join(),
    sort.optionFound === true
      ? `got ${JSON.stringify(sort.after)}, wanted ${JSON.stringify(sort.wanted)}`
      : 'the option row was never reached'
  );
  check(
    'the sort issues exactly one reorder request, in the new order',
    sort.sent?.length === 1 &&
      sort.sent[0]?.join() === sort.wanted.join() &&
      sort.other?.length === 0,
    `${String(sort.sent?.length)} reorder(s) ${JSON.stringify(sort.sent)}` +
      `, ${String(sort.other?.length)} other request(s) ${JSON.stringify(sort.other)}`
  );
  // Every arm above survives a store that threw on the response, because the
  // order on screen is the optimistic one. This is what makes them mean the
  // whole mutation rather than its first half.
  check(
    'the sort read the reorder response without throwing',
    sort.optionFound === true && sort.thrown?.length === 0,
    JSON.stringify(sort.thrown)
  );

  return results;
}

function report(title, results) {
  console.log(title);
  for (const { name, ok, detail } of results) {
    console.log(`  ${ok ? '✓' : '✗'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
  }
  return results.filter((r) => !r.ok).map((r) => r.name);
}

const server = await startServer();
const probe = new URL('scripts/board-probe.html', server.resolvedUrls.local[0]).href;
const failed = report(
  'check:column-menu — real column menu in headless Chrome',
  await runArms(probe)
);
await server.close();

/**
 * A source rewrite that puts one file back on a bug, so an arm can be shown to
 * notice. Mirrors scripts/check-board-layout-real.mjs; the tree is never written
 * to. `file` is a repo-relative path — the menu's bugs live in the component and
 * the sort's live in the store, and both are on the path this check drives.
 */
function regression(name, file, find, replace) {
  let applied = 0;
  return {
    name,
    plugin: {
      name: `column-menu-selftest-${name}`,
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith(file)) {
          return null;
        }
        // Counted by occurrence: a string pattern rewrites only the first match,
        // so a second one would be left on the fixed code while the tally read 1.
        const hits = code.split(find).length - 1;
        applied += hits;
        return hits === 0 ? null : code.replaceAll(find, () => replace);
      },
    },
    rewrites: () => applied,
  };
}

// Each regression names the arm it must break AND the arms it must leave alone.
// Without the second half any failure reads as the planted one being caught, and
// a check that has come off the component entirely reports the same green.
const PLANTED = [
  {
    ...regression(
      'sort-by-closes-the-menu',
      'src/components/ColumnHeader.svelte',
      'onclick={() => (sortSubmenuOpen = true)}',
      'onclick={() => closeMenu()}'
    ),
    what: 'the "Sort by" row dismissing the menu instead of expanding it',
    breaks: ['Sort by expands the sort options and leaves the menu open'],
    intact: ['the kebab opens the column menu', 'another menu item closes the menu (control)'],
  },
  {
    ...regression(
      'option-does-not-sort',
      'src/components/ColumnHeader.svelte',
      'void board.sortColumn(column.id, option.value);',
      ''
    ),
    what: 'a sort option closing the menu without sorting the column',
    breaks: [
      'the cards move before the server answers',
      'choosing a sort option re-orders the cards on screen',
      'the sort issues exactly one reorder request, in the new order',
    ],
    intact: ['Sort by expands the sort options and leaves the menu open'],
  },
  // The one the response-shaped arms cannot see: the request is right, the reply
  // is right, and re-stamping from the reply lands the column in the sorted order
  // anyway — so only the read taken before the answer is left holding the bug.
  {
    ...regression(
      'no-optimistic-order',
      'src/lib/board.svelte.ts',
      'new Map(restack(ordered).map(({ id, sort_key }) => [id, sort_key]))',
      'new Map()'
    ),
    what: 'the sort sending the reorder but leaving the cards where they were',
    breaks: ['the cards move before the server answers'],
    intact: [
      'choosing a sort option re-orders the cards on screen',
      'the sort issues exactly one reorder request, in the new order',
      'the sort read the reorder response without throwing',
    ],
  },
];

if (SELFTEST) {
  console.log('\ncheck:column-menu --selftest — sensitivity');
  let bad = 0;
  for (const planted of PLANTED) {
    const mutated = await startServer([planted.plugin]);
    const url = new URL('scripts/board-probe.html', mutated.resolvedUrls.local[0]).href;
    const broke = report(`\n  ${planted.what}`, await runArms(url));
    await mutated.close();

    // Rewriting nothing is the same failure the selftest exists to catch, wearing
    // the selftest's face.
    const rewrites = planted.rewrites();
    if (rewrites !== 1) {
      bad++;
      console.log(`  ✗ the selftest rewrote ${String(rewrites)} call sites (want exactly 1)`);
    }
    for (const arm of planted.breaks) {
      if (!broke.includes(arm)) {
        bad++;
        console.log(`  ✗ "${arm}" still passed with ${planted.what} put back`);
      }
    }
    for (const arm of planted.intact) {
      if (broke.includes(arm)) {
        bad++;
        console.log(`  ✗ "${arm}" failed too, so the failure does not name this bug`);
      }
    }
  }
  await browser.close();
  if (bad > 0 || failed.length > 0) {
    console.error(`\ncheck:column-menu --selftest — FAILED (${String(bad + failed.length)})`);
    process.exit(1);
  }
  console.log(
    `\ncheck:column-menu --selftest — passed (${String(PLANTED.length)} planted regressions, each caught by the arm that names it)`
  );
  process.exit(0);
}

await browser.close();
if (failed.length > 0) {
  console.error(`\ncheck:column-menu — ${String(failed.length)} FAILED`);
  process.exit(1);
}
console.log('\ncheck:column-menu — passed');
