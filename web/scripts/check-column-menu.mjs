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
// The done row's arms are here for the half of that gap a component test cannot
// reach at all: its check mark takes room from a label that already filled the
// row, and the wrapped result sits inside the row's min-height, so nothing short
// of a laid-out page can tell the two apart.
//
// Presses come from the driver, through Playwright's real mouse, and never from
// a MouseEvent built inside the page. This check spent its whole life green over
// a "Sort by" that dismissed the menu in every browser, because a dispatched
// click defers the submenu's render until after the event has finished
// propagating — so the window-level guard that dismisses this menu was handed a
// row still sitting in the DOM, which under a finger it never is. The header of
// browser.mjs's `click` has the measurement; the rule it leaves behind is that a
// press whose point is what other listeners see cannot be synthesised.
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

// Everything the page is asked, installed once per load. It reads and nothing
// else — the presses arrive from the driver — so no arm can be satisfied by an
// event this file made up. String concatenation rather than template literals
// throughout, so nothing in here collides with the `${}` of the driver.
const HARNESS = `(() => {
  const column = document.querySelector('[data-column-id="${COLUMN}"]');
  if (!column) return false;
  const menu = () => column.querySelector('[role="menu"]');
  const rows = () => (menu() ? [...menu().querySelectorAll('[role^="menuitem"]')] : []);
  const cards = () =>
    [...column.querySelectorAll('[data-task-id]')].map((el) => ({
      id: el.dataset.taskId,
      title: (el.querySelector('a[aria-label]') || el).getAttribute('aria-label') || '',
    }));
  window.__probe = {
    settled: () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    open: () => menu() !== null,
    // The trigger, not the popup: both carry this label, and once the menu is
    // open its "Sort by" row claims aria-haspopup="menu" as well.
    expanded: () =>
      column.querySelector('button[aria-label^="Options for"]').getAttribute('aria-expanded'),
    labels: () => rows().map((el) => el.textContent.trim()),
    cards,
    ids: () => cards().map((c) => c.id),
    // Line boxes, not the row's height: every row is min-h-11 and a second 20px
    // line still fits inside 44px, so the wrap this measures moves nothing a
    // height assertion — or anything jsdom can compute — would read.
    doneRow: () => {
      const row = rows().find((el) => el.textContent.trim() === 'Mark as done column');
      if (!row) return null;
      const label = row.querySelector('span');
      const range = document.createRange();
      range.selectNodeContents(label);
      return {
        checked: row.getAttribute('aria-checked'),
        icons: row.querySelectorAll('svg').length,
        // One rect per line box, deduped by top edge: a wrapped label reports two.
        lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
        // What the text needs against the room the row gives it — a label held to
        // one line by clipping is on one line and unreadable.
        needs: label.scrollWidth,
        room: label.clientWidth,
      };
    },
  };
  // The store applies its optimistic order before it sends anything, so every
  // arm below is satisfied by a sort that then died reading the response — which
  // is exactly what a stubbed server echoing the request body produces. Nothing
  // catches the rejection of a void-called mutation, so it surfaces here.
  window.__thrown = [];
  addEventListener('error', (e) => __thrown.push(String(e.message)));
  addEventListener('unhandledrejection', (e) =>
    __thrown.push(String((e.reason && e.reason.message) || e.reason))
  );
  return true;
})()`;

const KEBAB = `[data-column-id="${COLUMN}"] button[aria-label^="Options for"]`;
const PRESS_TARGET = '[data-press-target]';

// The row is tagged in the page rather than found by a Playwright text selector,
// so it is matched by the same `textContent.trim()` the arms report their labels
// from — a row named in a failure and the row that was pressed cannot be two
// different rows. (`:text-is` would also have missed every row whose label sits
// in a <span>, which "Sort by" does.) The tag goes on the row itself, so the
// press lands on the same element a finger would.
const markRow = (label) => `(() => {
  for (const stale of document.querySelectorAll('${PRESS_TARGET}')) {
    stale.removeAttribute('data-press-target');
  }
  const row = [
    ...document.querySelectorAll('[data-column-id="${COLUMN}"] [role="menu"] [role^="menuitem"]'),
  ].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
  if (!row) return false;
  row.setAttribute('data-press-target', '');
  return true;
})()`;

// Everything an arm asks about the menu, read two frames after the press that
// preceded it.
const MENU_STATE = `(async () => {
  await window.__probe.settled();
  return JSON.stringify({
    open: window.__probe.open(),
    expanded: window.__probe.expanded(),
    labels: window.__probe.labels(),
  });
})()`;

// The done row's geometry. The pause is for the toggle's own round trip: the row
// is measured after it has taken its check mark, not while it is taking it.
const DONE_ROW = `(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await window.__probe.settled();
  return JSON.stringify(window.__probe.doneRow());
})()`;

// Taken before anything is pressed. The order the store is about to compute,
// derived from the same titles by the same comparison in the same engine — so
// the expectation cannot drift from the seed data, and cannot disagree with the
// store over what `localeCompare` means.
const BEFORE_AND_WANTED = `(() => {
  const cards = window.__probe.cards();
  return JSON.stringify({
    before: cards.map((c) => c.id),
    wanted: [...cards].sort((a, b) => a.title.localeCompare(b.title)).map((c) => c.id),
  });
})()`;

const ARM_THE_REORDER = `(() => {
  window.__requests.length = 0;
  window.__answered.reorders = 0;
  return true;
})()`;

// The column as the store left it, with nothing back from the server yet — which
// the counter, read in the same turn, is what actually establishes.
const OPTIMISTIC_ORDER = `(async () => {
  await window.__probe.settled();
  return JSON.stringify({
    ids: window.__probe.ids(),
    answeredAtRead: window.__answered.reorders,
  });
})()`;

const AFTER_THE_ANSWER = `(async () => {
  await new Promise((r) => setTimeout(r, 500));
  await window.__probe.settled();
  const reorders = window.__requests.filter(
    (r) => r.method === 'POST' && r.path === '/api/columns/${COLUMN}/reorder'
  );
  return JSON.stringify({
    after: window.__probe.ids(),
    sent: reorders.map((r) => (r.body && r.body.task_ids) || null),
    other: window.__requests
      .filter((r) => !reorders.includes(r))
      .map((r) => r.method + ' ' + r.path),
    thrown: window.__thrown,
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
    if (await browser.eval(MOUNTED)) {
      // Installed per load, and its own answer is checked: a harness that found
      // no column would leave every later read throwing on `undefined`, which is
      // a broken check and not a broken menu.
      if ((await browser.eval(HARNESS)) !== true) break;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // Infrastructure, not a verdict on the component: nothing was measured, so
  // filing it among the arms would report a board that behaved badly.
  console.error('check:column-menu — FAILED: the board never mounted at %s', probeUrl);
  await browser.close();
  process.exit(1);
}

/** Everything the menu is showing, two frames after the last press. */
async function menuState() {
  return JSON.parse(await browser.eval(MENU_STATE));
}

/**
 * Press a row by the label a reader sees, with the real mouse. Tags it first and
 * reports a miss rather than clicking: a selector the menu does not have would
 * spend Playwright's whole timeout before failing, and the arm wants to name the
 * rows that were there instead.
 */
async function pressRow(label) {
  if ((await browser.eval(markRow(label))) !== true) {
    return false;
  }
  await browser.click(PRESS_TARGET);
  return true;
}

/**
 * Every arm, against one dev server. Returns `{ name, ok, detail }` per arm; the
 * name is what the selftest below matches on.
 */
async function runArms(probeUrl) {
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok, detail });

  await open(probeUrl);
  await browser.click(KEBAB);
  const opened = await menuState();
  check(
    'the kebab opens the column menu',
    opened.open === true && opened.expanded === 'true',
    `menu=${String(opened.open)} aria-expanded=${String(opened.expanded)}`
  );
  // Without this, "the menu stayed open after Sort by" is also what a press that
  // never landed looks like.
  const otherPressed = await pressRow('Archive all cards');
  const afterOther = otherPressed ? await menuState() : null;
  check(
    'another menu item closes the menu (control)',
    otherPressed && afterOther?.open === false,
    otherPressed
      ? 'the menu was still on screen after "Archive all cards"'
      : `no "Archive all cards" row among ${JSON.stringify(opened.labels)}`
  );

  // The done row gets its own page load because checking it is a one-way gesture
  // within a load, and the arms below want the row both ways.
  await open(probeUrl);
  await browser.click(KEBAB);
  const doneMenu = await menuState();
  const uncheckedDone = JSON.parse(await browser.eval(DONE_ROW));
  const donePressed = await pressRow('Mark as done column');
  const checkedDone = donePressed ? JSON.parse(await browser.eval(DONE_ROW)) : null;
  // Without this the two arms below are satisfied by a press that never landed:
  // the unchecked row has room to spare and has never wrapped.
  check(
    'the done row takes its check mark (control)',
    uncheckedDone?.checked === 'false' &&
      checkedDone?.checked === 'true' &&
      checkedDone.icons === uncheckedDone.icons + 1,
    uncheckedDone === null
      ? `no "Mark as done column" row among ${JSON.stringify(doneMenu.labels)}`
      : `aria-checked ${String(uncheckedDone.checked)}→${String(checkedDone?.checked)},` +
          ` ${String(uncheckedDone.icons)}→${String(checkedDone?.icons)} icons`
  );
  check(
    'the checked done row keeps its label on one line',
    checkedDone?.lines === 1,
    `${String(checkedDone?.lines)} line(s), ${String(uncheckedDone?.lines)} unchecked`
  );
  // The other way to hold a label to one line, and the one the row's own
  // `truncate` would reach for if the check mark left it without the room.
  check(
    'the checked done row shows its whole label',
    checkedDone !== null && checkedDone.needs <= checkedDone.room,
    `${String(checkedDone?.needs)}px of text in ${String(checkedDone?.room)}px`
  );

  await open(probeUrl);
  const { before, wanted } = JSON.parse(await browser.eval(BEFORE_AND_WANTED));
  await browser.click(KEBAB);
  const menu = await menuState();
  const sortPressed = await pressRow('Sort by');
  const submenu = sortPressed ? await menuState() : null;
  // The reported symptom, and the reason this file exists.
  check(
    'Sort by expands the sort options and leaves the menu open',
    submenu?.open === true && submenu.labels.includes('Alphabetically'),
    sortPressed
      ? `menu ${submenu?.open === true ? 'open' : 'closed'}, rows ${JSON.stringify(submenu?.labels)}`
      : `no "Sort by" row among ${JSON.stringify(menu.labels)}`
  );
  // Without this a column that was already alphabetical would let a sort that
  // does nothing at all pass the arm below.
  check(
    'the column is not already in the sorted order (control)',
    Array.isArray(before) && before.join() !== wanted.join(),
    `${String(before?.length)} cards`
  );

  const optionFound = submenu?.labels.includes('Alphabetically') === true;
  let optimistic = null;
  let settled = null;
  if (optionFound) {
    await browser.eval(ARM_THE_REORDER);
    await pressRow('Alphabetically');
    // Both reads race the probe's held response, which is why the first one
    // carries the counter that says whether it won.
    optimistic = JSON.parse(await browser.eval(OPTIMISTIC_ORDER));
    settled = JSON.parse(await browser.eval(AFTER_THE_ANSWER));
  }
  // The only arm a sort that sends the right request and moves nothing can fail:
  // the probe is still holding the response, so this order is the store's own.
  check(
    'the cards move before the server answers',
    optionFound && optimistic?.answeredAtRead === 0 && optimistic.ids.join() === wanted.join(),
    !optionFound
      ? 'the option row was never reached'
      : optimistic?.answeredAtRead !== 0
        ? `the reorder was already answered ${String(optimistic?.answeredAtRead)}x when the order was read`
        : `got ${JSON.stringify(optimistic?.ids)}, wanted ${JSON.stringify(wanted)}`
  );
  check(
    'choosing a sort option re-orders the cards on screen',
    optionFound && settled?.after.join() === wanted.join(),
    optionFound
      ? `got ${JSON.stringify(settled?.after)}, wanted ${JSON.stringify(wanted)}`
      : 'the option row was never reached'
  );
  check(
    'the sort issues exactly one reorder request, in the new order',
    settled?.sent.length === 1 &&
      settled.sent[0]?.join() === wanted.join() &&
      settled.other.length === 0,
    settled === null
      ? 'the option row was never reached'
      : `${String(settled.sent.length)} reorder(s) ${JSON.stringify(settled.sent)}` +
          `, ${String(settled.other.length)} other request(s) ${JSON.stringify(settled.other)}`
  );
  // Every arm above survives a store that threw on the response, because the
  // order on screen is the optimistic one. This is what makes them mean the
  // whole mutation rather than its first half.
  check(
    'the sort read the reorder response without throwing',
    optionFound && settled?.thrown.length === 0,
    settled === null ? 'the option row was never reached' : JSON.stringify(settled.thrown)
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
  // Two mechanisms keep the done row on one line — the label's own `truncate` and
  // a menu wide enough that it never has to bite — so neither is provable by
  // reverting the other alone. This rewrite puts the label back in the width the
  // check mark left it before the menu was widened AND takes the clip away, which
  // is the geometry the row actually shipped with. The width is an inline style
  // rather than a utility class because Tailwind builds its stylesheet from the
  // files on disk: a class that appears only in this rewrite's output has no rule
  // behind it, and the "planted" row would render unconstrained and pass.
  {
    ...regression(
      'done-label-wraps',
      'src/components/ColumnHeader.svelte',
      'class="flex-1 truncate">Mark as done column',
      'style="width:134px">Mark as done column'
    ),
    what: 'the done row wrapping its label under the check mark',
    breaks: ['the checked done row keeps its label on one line'],
    intact: [
      'the done row takes its check mark (control)',
      'the checked done row shows its whole label',
    ],
  },
  // The other half: with the menu back at its old width the label still cannot
  // wrap, because `truncate` clips it to one line instead.
  {
    ...regression(
      'menu-too-narrow-for-the-done-row',
      'src/components/ColumnHeader.svelte',
      'max-h-[80vh] w-64',
      'max-h-[80vh] w-56'
    ),
    what: 'a menu too narrow for the done row to show its label beside a check',
    breaks: ['the checked done row shows its whole label'],
    intact: [
      'the done row takes its check mark (control)',
      'the checked done row keeps its label on one line',
    ],
  },
  // The bug this check was rewritten for, and the reason the presses are real:
  // the guard is put back on the DOM, where the row it is asked about has just
  // been replaced by the submenu. Under the dispatched press this file used to
  // make, this plant is invisible — every arm below stays green.
  {
    ...regression(
      'guard-reads-a-detached-row',
      'src/components/ColumnHeader.svelte',
      'if (startedInside(event, menuEl)) {',
      'if (event.target instanceof Node && menuEl?.contains(event.target) === true) {'
    ),
    what: 'the outside-click guard judging a click by where its target sits now',
    breaks: ['Sort by expands the sort options and leaves the menu open'],
    intact: ['the kebab opens the column menu', 'another menu item closes the menu (control)'],
  },
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
