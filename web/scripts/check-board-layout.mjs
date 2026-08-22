#!/usr/bin/env node
// Real-layout regression check for the board / bottom-nav on mobile, against the
// hand-authored fixture (scripts/board-layout.fixture.html).
//
// jsdom (the vitest environment) has no layout engine, so component tests cannot
// catch the bugs this guards: the fixed bottom nav being pushed off-screen, a
// column growing past the board rather than scrolling its own cards, or a column
// drawn to the foot of the screen below its last card. This drives a real
// headless Chromium (via
// Playwright — scripts/lib/browser.mjs) and asserts the layout invariants.
//
//   node scripts/check-board-layout.mjs            # gate (used by `check:layout`)
//   node scripts/check-board-layout.mjs --selftest # also prove the test is sensitive
//   node scripts/check-board-layout.mjs --only=360 # one case; --list names them all
//
// Exits non-zero on any assertion failure. If Chromium isn't installed it
// exits 0 with a warning; CI installs it (`pnpm exec playwright install chromium`).
//
// NOTE: this checks a FAITHFUL FIXTURE, not the real component. For the real
// component, run `pnpm run check:layout:real` (scripts/check-board-layout-real.mjs).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createBrowser } from './lib/browser.mjs';
import { caseFilter } from './lib/case-filter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = pathToFileURL(join(__dirname, 'board-layout.fixture.html')).href;
const only = caseFilter(process.argv);

const browser = await createBrowser();
if (!browser) {
  console.warn('check:layout — skipped (Playwright Chromium not installed).');
  console.warn('  Run `pnpm exec playwright install chromium`.');
  process.exit(0);
}
const { setViewport, goto, eval: evalPage, close } = browser;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'small', width: 360, height: 640 },
];

const MEASURE = `(() => {
  const scroller = document.querySelector('[data-board-scroller]');
  const nav = document.querySelector('[data-bottom-nav]');
  const cols = [...document.querySelectorAll('[data-column-id]')];
  const panels = [...document.querySelectorAll('[data-column-panel]')];
  const list = document.querySelector('[data-column-id] [aria-label$="tasks"]');
  const sr = scroller.getBoundingClientRect();
  const nr = nav.getBoundingClientRect();
  const de = document.documentElement;
  const row = scroller.firstElementChild;
  const rr = row.getBoundingClientRect();
  const tile = document.querySelector('[data-add-column]');
  const rowStyle = getComputedStyle(row);
  return {
    // The track's own vertical padding, so "a column as tall as the board" can be
    // asserted against the height a column can actually have rather than against
    // a tolerance nobody can derive later.
    trackPadY: Math.round(
      (parseFloat(rowStyle.paddingTop) || 0) + (parseFloat(rowStyle.paddingBottom) || 0)
    ),
    // Blank track outside the end targets, and the gap between two columns to
    // measure it against. Scroll-independent on purpose: this is the track's own
    // padding, which is what decides whether the ends can sit against the board's
    // edges at all. A gutter is fine; half a viewport is the canvas we removed.
    columnGap: Math.round(parseFloat(rowStyle.columnGap) || 0),
    leadSpace: Math.round(cols[0].getBoundingClientRect().left - rr.left),
    tailSpace: Math.round(rr.right - tile.getBoundingClientRect().right),
    vw: window.innerWidth,
    vh: window.innerHeight,
    boardClientH: scroller.clientHeight,
    boardScrollH: scroller.scrollHeight,
    boardScrollW: scroller.scrollWidth,
    boardClientW: scroller.clientWidth,
    htmlScrollH: de.scrollHeight,
    htmlScrollW: de.scrollWidth,
    navTop: Math.round(nr.top),
    navWidth: Math.round(nr.width),
    colH: cols.map((c) => Math.round(c.getBoundingClientRect().height)),
    // The drawn column, which is the one a reader sees end. Its wrapper above
    // stays the board's height whatever it holds, so measuring that instead
    // reports every column as full and nothing about the cards inside it.
    panelH: panels.map((p) => Math.round(p.getBoundingClientRect().height)),
    // Blank surface between the composer and the bottom of the column: what a
    // column stretched past its content puts there, and the one reading that
    // tells a short column apart from a tall one on a large screen.
    addGap: panels.map((p) => {
      const add = p.querySelector('[data-quick-add]');
      return add === null
        ? null
        : Math.round(p.getBoundingClientRect().bottom - add.getBoundingClientRect().bottom);
    }),
    listScrolls: list ? list.scrollHeight > list.clientHeight + 2 : null,
  };
})()`;

async function render(query, viewport) {
  await setViewport({ ...viewport, mobile: true });
  await goto(`${FIXTURE}?${query}`);
  return evalPage(MEASURE);
}

// Invariants the fixed layout must satisfy at every size / column / task count.
// `tall` is true only when the task list holds more cards than the board is high,
// so the column MUST reach the board's height and scroll inside itself; `short`
// only when it holds far fewer, so the column must end well above the board's
// foot. Neither is asserted for the middling counts in between, where the honest
// answer depends on the card height the fixture happens to render.
function checkInvariants(m, viewport, { tall = false, short = false } = {}) {
  const failures = [];
  if (m.panelH.length !== m.colH.length) {
    failures.push(`columns drew no panel (${m.panelH.length} of ${m.colH.length})`);
  }
  if (!m.colH.every((h) => h <= m.boardClientH + 2)) {
    failures.push(`columns exceed the board (colH=${m.colH.join(',')} boardH=${m.boardClientH})`);
  }
  if (!m.panelH.every((h) => h <= m.boardClientH + 2)) {
    failures.push(
      `a column grows past the board instead of scrolling its cards (panelH=${m.panelH.join(',')} boardH=${m.boardClientH})`
    );
  }
  if (tall && !m.panelH.every((h) => h >= m.boardClientH - m.trackPadY - 2)) {
    failures.push(
      `a column of more cards than fit stops short of the board (panelH=${m.panelH.join(',')} boardH=${m.boardClientH})`
    );
  }
  // The point of the whole arrangement: a column of two cards is two cards tall,
  // not a screen tall with blank surface under them.
  if (short && !m.panelH.every((h) => h <= m.boardClientH - 120)) {
    failures.push(
      `a column of a few cards is drawn to the foot of the board (panelH=${m.panelH.join(',')} boardH=${m.boardClientH})`
    );
  }
  if (!m.addGap.every((gap) => gap !== null && gap <= 4)) {
    failures.push(`"+ Add task" is not at the bottom of its column (gaps=${m.addGap.join(',')})`);
  }
  if (m.boardScrollH > m.boardClientH + 2) {
    failures.push(
      `board overflows vertically (scrollH=${m.boardScrollH} > clientH=${m.boardClientH})`
    );
  }
  if (m.htmlScrollH > viewport.height + 2) {
    failures.push(
      `page overflows vertically (htmlScrollH=${m.htmlScrollH} > vh=${viewport.height})`
    );
  }
  if (m.htmlScrollW > viewport.width + 2) {
    failures.push(
      `page overflows horizontally (htmlScrollW=${m.htmlScrollW} > vw=${viewport.width})`
    );
  }
  // The mobile layout viewport must not expand beyond the device width. This is
  // the direct symptom of the abspos-overflow bug: an unclipped absolutely-
  // positioned descendant (e.g. a column-header sr-only badge) overflows the
  // document, and on mobile the layout viewport grows to fit it, which makes the
  // fixed bottom nav resolve against the oversized viewport.
  if (m.vw > viewport.width + 2) {
    failures.push(`mobile viewport expanded (innerWidth=${m.vw} > requested ${viewport.width})`);
  }
  if (m.navTop > viewport.height - 40) {
    failures.push(`bottom nav not visible (navTop=${m.navTop} vh=${viewport.height})`);
  }
  if (m.navWidth > viewport.width + 2) {
    failures.push(`bottom nav wider than screen (navWidth=${m.navWidth} vw=${viewport.width})`);
  }
  if (m.boardScrollW <= m.boardClientW + 2) {
    failures.push(
      `board does not scroll horizontally (scrollW=${m.boardScrollW} clientW=${m.boardClientW})`
    );
  }
  // The board's ends sit against its edges, so the track puts no more in front of
  // the first column or behind the last than it puts between any two. Centering
  // the ends needed half the leftover width there — 51px on a 390px phone, which
  // read as the board starting somewhere off to the right of where it does.
  if (m.leadSpace > m.columnGap + 2) {
    failures.push(`blank track in front of the first column (${m.leadSpace} > gap ${m.columnGap})`);
  }
  if (m.tailSpace > m.columnGap + 2) {
    failures.push(`blank track behind the last column (${m.tailSpace} > gap ${m.columnGap})`);
  }
  if (tall && m.listScrolls === false) {
    failures.push('tall task list does not scroll internally');
  }
  return failures;
}

const SELFTEST = process.argv.includes('--selftest');
const MATRIX = [
  { cols: 4, tasks: 2, short: true }, // few cards -> the column ends with them
  { cols: 4, tasks: 40, tall: true }, // more than fit -> scroll internally, not overflow
  { cols: 8, tasks: 12 }, // many columns -> horizontal scroll, no page overflow
];

let failed = 0;
console.log('check:layout — board + bottom-nav layout (real Chrome, fixture)');
for (const viewport of VIEWPORTS) {
  for (const { cols, tasks, ...expect } of MATRIX) {
    const name = `layout/${viewport.name} ${viewport.width}x${viewport.height} cols=${cols} tasks=${tasks}`;
    if (!only.wants(name)) {
      continue;
    }
    const m = await render(`cols=${cols}&tasks=${tasks}`, viewport);
    const failures = checkInvariants(m, viewport, expect);
    if (failures.length) {
      failed++;
      console.log(`  ✗ ${name}`);
      for (const f of failures) console.log(`      - ${f}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  }
}

if (SELFTEST) {
  // Sensitivity proof. This gate must catch every regression that affects the
  // mobile board, and the current markup must survive every condition:
  //   1. abspos-overflow (the bug that shipped): with no sim, the LEGACY markup
  //      (scroller not `relative`) lets column-header sr-only badges overflow
  //      the document and expand the mobile viewport. Current must pass, legacy fail.
  //   2. percentage-height: under the mobile resolution failure (sim=1), the
  //      current markup is untouched — it uses no percentage height — while
  //      legacy collapses.
  //   3. content-height: a column put back on filling the board however few cards
  //      it holds (stretch=1) must fail the case that holds two.
  console.log('\ncheck:layout --selftest — sensitivity');
  const vp = VIEWPORTS[0];
  const cases = [
    ['abspos-overflow / current  (no sim)', 'cols=4&tasks=40', { tall: true }, true],
    ['abspos-overflow / legacy   (no sim)', 'cols=4&tasks=40&legacy=1', { tall: true }, false],
    ['pct-height / current  (sim)  ', 'cols=4&tasks=40&sim=1', { tall: true }, true],
    ['pct-height / legacy   (sim)  ', 'cols=4&tasks=40&legacy=1&sim=1', { tall: true }, false],
    ['content-height / current  ', 'cols=4&tasks=2', { short: true }, true],
    ['content-height / stretched', 'cols=4&tasks=2&stretch=1', { short: true }, false],
  ];
  for (const [label, query, expect, mustPass] of cases) {
    // Named under the phase they prove, so `--only=layout` brings its own
    // sensitivity proof along and never leaves a filtered run asserting
    // something about cases that did not run.
    if (!only.wants(`layout/selftest ${label.trim()}`)) {
      continue;
    }
    const m = await render(query, vp);
    const failures = checkInvariants(m, vp, expect);
    const passed = failures.length === 0;
    const ok = passed === mustPass;
    if (!ok) failed++;
    const want = mustPass ? 'should pass' : 'should fail';
    console.log(
      `  ${ok ? '✓' : '✗'} ${label}: ${want} -> ${passed ? 'passed' : 'failed (' + failures.length + ')'}`
    );
    if (!ok) for (const f of failures.slice(0, 3)) console.log(`      - ${f}`);
  }
}

close();
only.finish('check:layout');
if (failed > 0) {
  console.log(`\ncheck:layout — FAILED (${failed})`);
  process.exit(1);
}
console.log(`\ncheck:layout — ${only.summary('passed')}`);
process.exit(0);
