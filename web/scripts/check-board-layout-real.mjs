#!/usr/bin/env node
// Real-component layout check: mounts the ACTUAL Board.svelte (via
// scripts/board-probe.html) in headless Chrome and asserts the mobile layout
// invariants. Complements scripts/check-board-layout.mjs (which checks a
// hand-authored fixture): this catches bugs the fixture can't model (real
// Tailwind output, real svelte-dnd-action, real component structure).
//
//   npm run check:layout:real
//
// Boots vite in-process on the first free port at or above 5180 (override with
// VITE_PORT), measures, tears down. Two worktrees can therefore run this check
// at once, and a killed run leaves no server behind to fail the next one. Skips
// with exit 0 if Chromium isn't installed. Exits non-zero on assertion failure.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname); // repo root (worktree root)

const server = await createServer({
  root: ROOT,
  // logLevel keeps vite's ready-banner out of the check's output while leaving
  // the warnings and transform errors that explain a failure on stderr.
  logLevel: 'warn',
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT ?? '5180'),
    strictPort: false,
  },
});
await server.listen();
const teardown = () => server.close();
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const PROBE = new URL('scripts/board-probe.html', server.resolvedUrls.local[0]).href;

// Read from the module the component uses, so the probe's timing cannot drift
// from the window the swipe fallback actually applies.
const { MOMENTUM_WINDOW_MS } = await server.ssrLoadModule('/src/lib/board-scroll.ts');

const browser = await createBrowser();
if (!browser) {
  console.warn('check:layout:real — skipped (Playwright Chromium not installed).');
  console.warn('  Run `npx playwright install chromium`.');
  await teardown();
  process.exit(0);
}
const { setViewport, goto, eval: evalPage, close } = browser;

const MEASURE = `(() => {
  const board = [...document.querySelectorAll('div')].find(
    (el) => getComputedStyle(el).overflowX === 'auto'
  );
  const nav = [...document.querySelectorAll('nav')].find((n) => {
    const cs = getComputedStyle(n);
    return cs.position === 'fixed' && cs.display !== 'none';
  });
  const cols = [...document.querySelectorAll('section')];
  const nr = nav?.getBoundingClientRect();
  const bar = document.querySelector('[aria-label="Selection actions"]');
  const br = bar?.getBoundingClientRect();
  const de = document.documentElement;
  return {
    cols: cols.length,
    cards: document.querySelectorAll('[data-task-id]').length,
    vw: innerWidth,
    vh: innerHeight,
    htmlSW: de.scrollWidth,
    htmlSH: de.scrollHeight,
    boardSW: board?.scrollWidth,
    boardCW: board?.clientWidth,
    boardCH: board?.clientHeight,
    // The board always snap-scrolls columns on mobile (during a drag the board's
    // overflow flips to hidden so svelte-dnd-action can't fling it, but snap stays on).
    boardSnap: board && getComputedStyle(board).scrollSnapType,
    colH: cols.map((c) => Math.round(c.getBoundingClientRect().height)),
    navTop: nr && Math.round(nr.top),
    navW: nr && Math.round(nr.width),
    barBottom: br && Math.round(br.bottom),
    barW: br && Math.round(br.width),
    barTaps: bar && [...bar.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return Math.round(Math.min(r.width, r.height));
    }),
  };
})()`;

function check(m, vp) {
  const f = [];
  // Every height assertion below is satisfied trivially by a column that drew no
  // cards, so a card that throws while rendering would otherwise pass this check.
  if (m.cards !== vp.cols * vp.tasks)
    f.push(`cards did not render (${m.cards} of ${vp.cols * vp.tasks})`);
  if (m.htmlSW > vp.w + 2)
    f.push(`document overflows horizontally (scrollWidth=${m.htmlSW} > ${vp.w})`);
  if (m.vw > vp.w + 2) f.push(`mobile viewport expanded (innerWidth=${m.vw} > ${vp.w})`);
  if (m.htmlSH > vp.h + 2)
    f.push(`document overflows vertically (scrollHeight=${m.htmlSH} > ${vp.h})`);
  if (m.navTop === undefined || m.navTop > vp.h - 40)
    f.push(`bottom nav not visible (navTop=${m.navTop})`);
  if (m.navW === undefined || m.navW > vp.w + 2)
    f.push(`bottom nav wider than screen (navW=${m.navW})`);
  if (m.boardSW === undefined || m.boardSW <= m.boardCW + 2)
    f.push(`board does not scroll horizontally (scrollW=${m.boardSW} clientW=${m.boardCW})`);
  if (!m.colH.every((h) => h <= m.boardCH + 2))
    f.push(`columns exceed board height (colH=${m.colH.join(',')} boardCH=${m.boardCH})`);
  // Resting scroll-snap: mandatory on mobile (column-by-column), off on desktop.
  const wantSnap = vp.mobile ? 'x mandatory' : 'none';
  if (m.boardSnap !== wantSnap)
    f.push(`board scroll-snap-type=${m.boardSnap} (want ${wantSnap} at rest)`);
  if (!vp.selected) {
    if (m.barBottom !== undefined) f.push('selection bar drawn with nothing selected');
  } else if (m.barBottom === undefined) {
    f.push('selection bar did not render');
  } else {
    // The whole point of docking the bar inside the board column instead of
    // floating it over the viewport: it can never reach the bottom nav.
    if (m.navTop !== undefined && m.barBottom > m.navTop + 2)
      f.push(`selection bar overlaps the bottom nav (barBottom=${m.barBottom} navTop=${m.navTop})`);
    if (m.barBottom > vp.h + 2)
      f.push(`selection bar below the viewport (barBottom=${m.barBottom} vh=${vp.h})`);
    if (m.barW > vp.w + 2) f.push(`selection bar wider than screen (barW=${m.barW} vw=${vp.w})`);
    if (m.barTaps.length !== 5) f.push(`selection bar has ${m.barTaps.length} buttons (want 5)`);
    if (!m.barTaps.every((t) => t >= 44))
      f.push(`selection bar tap target below 44px (${m.barTaps.join(',')})`);
  }
  return f;
}

const CASES = [
  { w: 390, h: 844, cols: 4, tasks: 2 }, // short columns -> still fill (no gap)
  { w: 390, h: 844, cols: 4, tasks: 40 }, // tall columns -> scroll internally
  { w: 390, h: 844, cols: 8, tasks: 20 }, // many columns -> horizontal scroll, no document overflow
  { w: 1280, h: 800, cols: 4, tasks: 12 }, // desktop: lg sidebar, no bottom nav
  { w: 390, h: 844, cols: 4, tasks: 40, selected: 3 }, // selection bar: board gives up the height, nav keeps its own
  { w: 360, h: 640, cols: 4, tasks: 40, selected: 3 }, // narrowest phone: count + five 44px targets on one row
  { w: 1280, h: 800, cols: 4, tasks: 12, selected: 3 }, // desktop: bar docks above the fold, no nav to clear
];

let failed = 0;
console.log(`check:layout:real — real Board.svelte in headless Chrome (${new URL(PROBE).origin})`);
for (const c of CASES) {
  const mobile = c.w < 1024;
  await setViewport({ width: c.w, height: c.h, mobile });
  await goto(`${PROBE}?cols=${c.cols}&tasks=${c.tasks}&selected=${c.selected ?? 0}`, { wait: 700 });
  const m = await evalPage(MEASURE);
  // On desktop the bottom nav is display:none; allow navTop/navW to be undefined.
  const failures = mobile
    ? check(m, { ...c, mobile })
    : check(m, { ...c, mobile }).filter((x) => !x.includes('bottom nav'));
  // The desktop case disables snap via lg:snap-none, so its resting value is 'none' too.
  const tag = `${mobile ? 'MOBILE' : 'DESKTOP'} ${c.w}x${c.h} cols=${c.cols} tasks=${c.tasks} selected=${c.selected ?? 0}`;
  if (failures.length) {
    failed++;
    console.log(`  ✗ ${tag}`);
    for (const x of failures) console.log(`      - ${x}`);
    console.log(`      metrics: ${JSON.stringify(m)}`);
  } else {
    console.log(`  ✓ ${tag} (htmlSW=${m.htmlSW}, navW=${m.navW})`);
  }
}

// --- Scroll behavior ---
// The board must move only when the user moved it. jsdom models no scrolling at
// all, so these are the only tests that can see the real thing: whether it drifts
// on arrival, and which of the gestures below the swipe fallback will act on.
//
// The browser helper exposes no page.touchscreen, so a real fling — and with it
// scroll-snap-stop end to end — cannot be driven here. Synthetic touch events
// plus a programmatic scrollTo model the gesture *shapes* the fallback keys off,
// which is what these assert; `snapStopAll` asserts the CSS contract instead.
const SCROLL_PROBE = `(async () => {
  const board = [...document.querySelectorAll('div')].find(
    (el) => getComputedStyle(el).overflowX === 'auto'
  );
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = () => new Promise((r) => {
    const done = () => { clearTimeout(timer); board.removeEventListener('scrollend', done); r(); };
    const timer = setTimeout(done, 900);
    board.addEventListener('scrollend', done, { once: true });
  });
  const jump = () => board.scrollTo({ left: Math.round(board.clientWidth * 2.5), behavior: 'auto' });

  const samples = window.__boardScroll ?? [];
  while (samples.length < 120) await pause(50);
  const drift = Math.max(...samples) - Math.min(...samples);
  const resting = board.scrollLeft;

  jump();
  await settle();
  const landed = board.scrollLeft;
  await pause(700);
  const afterWheel = board.scrollLeft;

  // Every snap target must be reachable. The end ones are where that fails:
  // aligning them needs half a viewport of space beyond the board's gutter, and
  // without it the ideal scroll position is off the scrollable range entirely —
  // whereupon a mandatory-snap container resolves to some other column.
  const targets = [...board.querySelectorAll('*')].filter(
    (el) => getComputedStyle(el).scrollSnapAlign.split(' ').pop() !== 'none'
  );
  const offBy = (el) => {
    const r = el.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    return Math.round(Math.abs((r.left + r.width / 2) - (b.left + board.clientWidth / 2)));
  };
  // Distance to the NEAREST snap target's center: zero exactly when the board is
  // parked on a snap position. Parked between two, it is one layout change away
  // from resolving onto a neighbor.
  const offSnap = () => (targets.length ? Math.min(...targets.map(offBy)) : null);
  const landedOffSnap = offSnap();

  // One whole gesture, in the order a fling really happens: finger down on a
  // resting board, a drag that scrolls it a little, the finger up, and only then
  // the travel momentum contributes — which the jump stands in for. Putting the
  // jump before the lift would model a deliberate drag across several columns,
  // a scroll the fallback is supposed to leave alone.
  //
  // 'drag' dispatches the scroll a finger drag produces rather than performing
  // one. A real drag pans the content freely and snaps only when it ends, but a
  // programmatic scrollTo is re-snapped immediately — under mandatory snap a
  // sub-column scrollTo moves nothing and fires no event at all, so it cannot
  // stand in for the part of the gesture that happens before the lift.
  const gesture = async (steps) => {
    board.scrollTo({ left: 0, behavior: 'auto' });
    await settle();
    for (const step of steps) {
      if (step === 'down') board.dispatchEvent(new Event('touchstart'));
      else if (step === 'up') board.dispatchEvent(new Event('touchend'));
      else if (step === 'drag') board.dispatchEvent(new Event('scroll'));
      else if (step === 'jump') jump();
      else await pause(step);
    }
    await settle();
    await pause(700);
    return board.scrollLeft;
  };

  const afterTouch = await gesture(['down', 'drag', 'up', 'jump']);
  const afterLateSettle = await gesture(['down', 'drag', 'up', ${MOMENTUM_WINDOW_MS + 300}, 'jump']);
  const afterSecondSwipe = await gesture(['down', 'drag', 'up', 'down', 'drag', 'up', 'jump']);
  const afterHeldFinger = await gesture(['down', 'drag', 'jump']);

  board.scrollTo({ left: 0, behavior: 'auto' });
  await settle();
  board.dispatchEvent(new Event('scrollend'));
  await pause(700);
  const afterBareScrollEnd = board.scrollLeft;

  board.scrollTo({ left: 0, behavior: 'auto' });
  await settle();
  const firstOffCenter = targets.length ? offBy(targets[0]) : null;
  const restingOffSnap = offSnap();
  board.scrollTo({ left: board.scrollWidth, behavior: 'auto' });
  await settle();
  const lastOffCenter = targets.length ? offBy(targets[targets.length - 1]) : null;

  // LAST, because it mutates the board: a teammate's column arriving over the
  // wire while the user is only reading. The container must re-snap after the
  // layout change, and animate:flip is transforming the very sections that define
  // its snap positions while it does.
  //
  // The invariant is the column under the user, not the scroll offset: one
  // arriving BEFORE theirs must carry the board along to keep it centered, so a
  // scrollLeft that holds still there is the bug, not the fix. Only for one
  // arriving after does nothing ahead of them change, and the offset must hold too.
  const centered = () => {
    const b = board.getBoundingClientRect();
    const mid = b.left + board.clientWidth / 2;
    let best = null;
    let bestDist = Infinity;
    for (const el of board.querySelectorAll('[data-column-id]')) {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestDist) { bestDist = d; best = el.dataset.columnId; }
    }
    return best;
  };

  board.scrollTo({ left: Math.round(board.clientWidth * 1.5), behavior: 'auto' });
  await settle();
  const beforeInsert = board.scrollLeft;
  const columnBeforeAppend = centered();
  window.__addColumn('end');
  await pause(900);
  const afterInsert = board.scrollLeft;
  const columnAfterAppend = centered();

  const columnBeforePrepend = centered();
  window.__addColumn('start');
  await pause(900);
  const columnAfterPrepend = centered();

  return {
    drift, resting, landed, afterWheel,
    afterTouch, afterLateSettle, afterSecondSwipe, afterHeldFinger, afterBareScrollEnd,
    beforeInsert, afterInsert,
    columnBeforeAppend, columnAfterAppend, columnBeforePrepend, columnAfterPrepend,
    snapTargets: targets.length,
    snapStopAll: targets.every((el) => getComputedStyle(el).scrollSnapStop === 'always'),
    restingOffSnap, landedOffSnap,
    firstOffCenter, lastOffCenter,
    step: board.clientWidth,
  };
})()`;

function checkScroll(s, mobile) {
  const f = [];
  if (s.drift > 2) f.push(`board drifted ${s.drift}px after arrival with no input`);
  if (mobile && s.resting > 2) f.push(`board did not arrive at the first column (${s.resting})`);
  if (Math.abs(s.afterWheel - s.landed) > 2)
    f.push(`untouched scroll was paginated (landed=${s.landed} -> ${s.afterWheel})`);
  // Every one of these moved the board after the fact under the old corrector,
  // which armed on any touch and stayed armed until some later scrollend.
  if (s.afterSecondSwipe < s.afterWheel - 2)
    f.push(`a second swipe was pulled back (${s.afterSecondSwipe} of ${s.afterWheel})`);
  if (s.afterLateSettle < s.afterWheel - 2)
    f.push(`a settle past the momentum window was corrected (${s.afterLateSettle})`);
  if (s.afterHeldFinger < s.afterWheel - 2)
    f.push(`a scroll settling with the finger down was corrected (${s.afterHeldFinger})`);
  if (s.afterBareScrollEnd > 2)
    f.push(`a scrollend with no scroll behind it moved the board (${s.afterBareScrollEnd})`);
  if (Math.abs(s.afterInsert - s.beforeInsert) > 2)
    f.push(
      `a column arriving after the viewed one moved the board (${s.beforeInsert} -> ${s.afterInsert})`
    );
  if (s.columnAfterAppend !== s.columnBeforeAppend)
    f.push(
      `a column arriving over the wire changed the viewed column (${s.columnBeforeAppend} -> ${s.columnAfterAppend})`
    );
  if (mobile) {
    // The fallback must still be alive where scroll-snap-stop can be ignored:
    // one column advanced, not the two and a half the scroll asked for.
    if (s.afterTouch >= s.afterWheel - 2)
      f.push(`touch swipe was not capped at one column (${s.afterTouch} of ${s.afterWheel})`);
    if (s.afterTouch <= 2) f.push(`touch swipe advanced nothing (${s.afterTouch})`);
    if (s.snapTargets < 2) f.push(`board exposed ${s.snapTargets} snap targets`);
    // The primary cap, now that the JS fallback refuses everything it cannot
    // attribute to one gesture. If this lapses, nothing replaces it.
    if (!s.snapStopAll) f.push('a snap target is missing scroll-snap-stop: always');
    // A mandatory-snap board must come to rest ON a snap position.
    if (s.restingOffSnap > 2) f.push(`board rests between columns (off by ${s.restingOffSnap}px)`);
    // Snap-target tracking is what keeps the user's column under them when one
    // arrives ahead of it. A non-snapping board holds its offset instead and
    // silently shows them the previous column — which is why this is mobile-only.
    if (s.columnAfterPrepend !== s.columnBeforePrepend)
      f.push(
        `a column arriving before the viewed one displaced it (${s.columnBeforePrepend} -> ${s.columnAfterPrepend})`
      );
    if (s.landedOffSnap > 2) f.push(`board settled between columns (off by ${s.landedOffSnap}px)`);
    // Phones center their columns, so scrolling to either end must land the end
    // target dead center. A non-zero reading is space the layout never made.
    if (s.firstOffCenter > 2)
      f.push(`first column cannot reach center (off by ${s.firstOffCenter}px)`);
    if (s.lastOffCenter > 2)
      f.push(`last column cannot reach center (off by ${s.lastOffCenter}px)`);
  } else if (Math.abs(s.afterTouch - s.afterWheel) > 2) {
    f.push(`touch swipe was paginated where the board does not snap (${s.afterTouch})`);
  }
  return f;
}

const SCROLL_CASES = [
  { w: 390, h: 844, cols: 12, tasks: 3 },
  { w: 1280, h: 800, cols: 12, tasks: 3 },
];

console.log('\ncheck:layout:real — board scroll behavior');
for (const c of SCROLL_CASES) {
  const mobile = c.w < 1024;
  await setViewport({ width: c.w, height: c.h, mobile });
  await goto(`${PROBE}?cols=${c.cols}&tasks=${c.tasks}`, { wait: 700 });
  const s = await evalPage(SCROLL_PROBE);
  const failures = checkScroll(s, mobile);
  const tag = `${mobile ? 'MOBILE' : 'DESKTOP'} ${c.w}x${c.h} cols=${c.cols}`;
  if (failures.length) {
    failed++;
    console.log(`  ✗ ${tag}`);
    for (const x of failures) console.log(`      - ${x}`);
    console.log(`      metrics: ${JSON.stringify(s)}`);
  } else {
    console.log(`  ✓ ${tag} (${JSON.stringify(s)})`);
  }
}

await close();
await teardown();
if (failed > 0) {
  console.log(`\ncheck:layout:real — FAILED (${failed})`);
  process.exit(1);
}
console.log('\ncheck:layout:real — passed');
process.exit(0);
