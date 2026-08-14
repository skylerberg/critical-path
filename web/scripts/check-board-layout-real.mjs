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
// LAYOUT_PROBE_PORT), measures, tears down. Two worktrees can therefore run this
// check at once, and a killed run leaves no server behind to fail the next one.
// Skips with exit 0 if Chromium isn't installed. Exits non-zero on assertion
// failure.
//
// The scroll phase is most of the runtime — around 27s per case against 1s for a
// layout case — so iterating on it wants `--only=scroll`, or `--only=740` for the
// one case. `--list` prints the names, and a pattern is a plain substring of one:
// `scroll/740` looks like it should work and matches nothing, because the name is
// `scroll/mobile 740x900 cols=12`. See scripts/lib/case-filter.mjs; the name a
// case prints is the key it is selected by, so pasting a printed line back always
// works where inventing a shorthand may not.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';
import { caseFilter } from './lib/case-filter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname); // repo root (worktree root)

const SELFTEST = process.argv.includes('--selftest');
const only = caseFilter(process.argv);

async function startServer(plugins = []) {
  const created = await createServer({
    root: ROOT,
    // logLevel keeps vite's ready-banner out of the check's output while leaving
    // the warnings and transform errors that explain a failure on stderr.
    logLevel: 'warn',
    plugins,
    server: {
      host: '127.0.0.1',
      port: Number(process.env.LAYOUT_PROBE_PORT ?? '5180'),
      strictPort: false,
    },
  });
  await created.listen();
  return created;
}

const server = await startServer();
const teardown = () => server.close();
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const PROBE = new URL('scripts/board-probe.html', server.resolvedUrls.local[0]).href;

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
  const cols = [...document.querySelectorAll('[data-column-id]')];
  const nr = nav?.getBoundingClientRect();
  const bar = document.querySelector('[aria-label="Selection actions"]');
  const br = bar?.getBoundingClientRect();
  const de = document.documentElement;
  return {
    requests: window.__requests.map((r) => r.method + ' ' + r.path),
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
  // Reading a board must not write to one. This is also what keeps the probe
  // measuring its own fixture: a request that escapes here reaches a real API on
  // the machine of anyone running one, and comes back with a different board.
  if (m.requests.length)
    f.push(`the board talked to the server just by being shown (${m.requests.join(', ')})`);
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

// The name is the phase plus what distinguishes the case inside it, and it is
// both what gets printed and what `--only=` matches — so a failing line can be
// pasted back verbatim to re-run just that case.
function layoutName(c) {
  const device = c.w < 1024 ? 'mobile' : 'desktop';
  return `layout/${device} ${c.w}x${c.h} cols=${c.cols} tasks=${c.tasks} selected=${c.selected ?? 0}`;
}

let failed = 0;
console.log(`check:layout:real — real Board.svelte in headless Chrome (${new URL(PROBE).origin})`);
for (const c of CASES) {
  const name = layoutName(c);
  if (!only.wants(name)) {
    continue;
  }
  const mobile = c.w < 1024;
  await setViewport({ width: c.w, height: c.h, mobile });
  await goto(`${PROBE}?cols=${c.cols}&tasks=${c.tasks}&selected=${c.selected ?? 0}`, { wait: 700 });
  const m = await evalPage(MEASURE);
  // On desktop the bottom nav is display:none; allow navTop/navW to be undefined.
  const failures = mobile
    ? check(m, { ...c, mobile })
    : check(m, { ...c, mobile }).filter((x) => !x.includes('bottom nav'));
  // The desktop case disables snap via lg:snap-none, so its resting value is 'none' too.
  if (failures.length) {
    failed++;
    console.log(`  ✗ ${name}`);
    for (const x of failures) console.log(`      - ${x}`);
    console.log(`      metrics: ${JSON.stringify(m)}`);
  } else {
    console.log(`  ✓ ${name} (htmlSW=${m.htmlSW}, navW=${m.navW})`);
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

  // Every snap target must be reachable. The end ones are where that fails: a
  // centered end target needs half a viewport of space beyond the board's gutter,
  // and without it the ideal scroll position is off the scrollable range entirely
  // — whereupon a mandatory-snap container resolves to some other column. Aligning
  // the ends to the board's edges is what buys that back with no space at all.
  const targets = [...board.querySelectorAll('*')].filter(
    (el) => getComputedStyle(el).scrollSnapAlign.split(' ').pop() !== 'none'
  );
  const boardStyle = getComputedStyle(board);
  const padLeft = parseFloat(boardStyle.scrollPaddingLeft) || 0;
  const padRight = parseFloat(boardStyle.scrollPaddingRight) || 0;
  // The scrollLeft that parks one target, alignment and all — clientWidth rather
  // than the rect's right edge, so a scrollbar never enters the reading. The
  // board's targets no longer agree on alignment: the ends align to its edges and
  // everything between centers, so measuring every one of them from the middle of
  // the screen would report the ends as permanently off-snap.
  const snapLeft = (el) => {
    const r = el.getBoundingClientRect();
    const b = board.getBoundingClientRect();
    const right = b.left + board.clientWidth;
    const align = getComputedStyle(el).scrollSnapAlign.split(' ').pop();
    if (align === 'center') {
      return board.scrollLeft + ((r.left + r.right) / 2 - (b.left + right) / 2);
    }
    if (align === 'end') {
      return board.scrollLeft + (r.right - right + padRight);
    }
    return board.scrollLeft + (r.left - b.left - padLeft);
  };
  const offBy = (el) => Math.round(Math.abs(snapLeft(el) - board.scrollLeft));
  // Distance to the NEAREST target's snap position: zero exactly when the board is
  // parked on one. Parked between two, it is one layout change away from resolving
  // onto a neighbor.
  const offSnap = () => (targets.length ? Math.min(...targets.map(offBy)) : null);
  const landedOffSnap = offSnap();

  // WHICH target the board is parked on, as an index. The swipe assertions below
  // are written against this rather than against a scroll delta: a delta compared
  // only to another delta is blind to the board counting from the wrong target,
  // because both readings then move by the same wrong amount and still agree.
  const snapIndex = () => {
    if (!targets.length) {
      return null;
    }
    let best = 0;
    let bestDistance = Infinity;
    targets.forEach((el, i) => {
      const distance = offBy(el);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  };

  // A real finger gesture, dispatched as real TouchEvents. The board takes the
  // horizontal gesture over on touch, so this drives the production path end to
  // end — which the previous native-snap arrangement could not be tested for at
  // all, since no programmatic scroll imitates a fling.
  const at = (x, y) => [new Touch({ identifier: 1, target: board, clientX: x, clientY: y })];
  const send = (type, points) =>
    board.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === 'touchend' ? [] : points,
        changedTouches: points.length ? points : at(0, 0),
      })
    );
  // One gesture from wherever the board is now. Everything below that measures
  // chaining needs that: resetting to the first column between gestures is exactly
  // what kept the shipped check from ever seeing a swipe arrive mid-slide.
  const gesture = async (dx, dy = 0, steps = 6) => {
    send('touchstart', at(200, 300));
    for (let i = 1; i <= steps; i++) {
      send('touchmove', at(200 + (dx * i) / steps, 300 + (dy * i) / steps));
      await pause(16); // one frame, so velocity is sampled the way it is in life
    }
    send('touchend', at(200 + dx, 300 + dy));
  };

  const swipe = async (dx, dy = 0, steps = 6) => {
    board.scrollTo({ left: 0, behavior: 'auto' });
    await settle();
    const before = board.scrollLeft;
    const indexBefore = snapIndex();
    await gesture(dx, dy, steps);
    await settle();
    await pause(700);
    return { before, after: board.scrollLeft, indexBefore, indexAfter: snapIndex() };
  };

  const swipeOne = await swipe(-120);
  const swipeFar = await swipe(-2000);
  const swipeBack = await swipe(120);
  const swipeShort = await swipe(-10);
  const swipeVertical = await swipe(-6, 200);

  // --- Gestures that arrive before the last one has finished ---
  // The board suspends scroll-snap on itself while it slides onto a column, and
  // that suspension used to be indistinguishable from the lg:snap-none that
  // means "desktop, leave the board alone" — so a swipe arriving mid-slide was
  // refused, with snap off, and whatever else moved the board moved it
  // unconstrained. Everything above resets to the first column and waits 700ms
  // between gestures, which is precisely why none of it could see that.
  const restAt = async (left) => {
    board.scrollTo({ left, behavior: 'auto' });
    await settle();
    await pause(200);
  };

  await restAt(0);
  await gesture(-120);
  await pause(150); // inside the slide, not after it
  await gesture(-120);
  await pause(1100);
  const chained = { index: snapIndex(), off: offSnap() };

  // ...and the same thing over the length of the board, at a cadence a thumb
  // actually produces. Every target in order, none of them twice.
  await restAt(0);
  const walk = [snapIndex()];
  for (let i = 0; i < targets.length + 1; i++) {
    await gesture(-120);
    await pause(230);
    walk.push(snapIndex());
  }
  await pause(900);
  const walked = { visited: walk, end: snapIndex(), off: offSnap() };

  // The end of the board, where the reported bouncing was: the last snap target
  // is the "+ Add column" tile, so a swipe onto the last real COLUMN has to rest
  // on the column and not carry on to the tile behind it.
  const positions = targets.map(snapLeft);
  const lastColumn = targets.length - 2;
  await restAt(positions[lastColumn - 1]);
  await gesture(-120);
  await pause(1100);
  const intoLastColumn = { want: lastColumn, index: snapIndex(), off: offSnap() };

  // A second finger is a pinch, not a swipe. Refusing it used to drop the gesture
  // without releasing the suspension, and the board then read as a desktop board
  // for the rest of its life and refused every swipe after it.
  await restAt(0);
  send('touchstart', at(200, 300));
  await pause(16);
  send('touchmove', at(160, 300));
  await pause(16);
  send('touchstart', [...at(160, 300), new Touch({ identifier: 2, target: board, clientX: 80, clientY: 300 })]);
  await pause(16);
  send('touchend', []);
  await pause(1100);
  const pinchedSnap = getComputedStyle(board).scrollSnapType;
  const beforeRecovery = snapIndex();
  await gesture(-120);
  await pause(1100);
  const afterPinch = { snap: pinchedSnap, from: beforeRecovery, to: snapIndex() };

  board.scrollTo({ left: 0, behavior: 'auto' });
  await settle();
  board.dispatchEvent(new Event('scrollend'));
  await pause(700);
  const afterBareScrollEnd = board.scrollLeft;

  // The track's own gutter is the only thing that may sit outside the end targets.
  // Reading it off the row rather than hard-coding 12 keeps the breakpoint that
  // sets it in the class list, where it belongs.
  const rowStyle = getComputedStyle(board.firstElementChild);
  const gutterLeft = parseFloat(rowStyle.paddingLeft) || 0;
  const gutterRight = parseFloat(rowStyle.paddingRight) || 0;
  const first = targets[0];
  const last = targets[targets.length - 1];

  board.scrollTo({ left: 0, behavior: 'auto' });
  await settle();
  const restingOffSnap = offSnap();
  // Blank canvas in front of the first column, beyond the gutter every column
  // gets. Centering the first column is what put half a viewport of it there.
  const firstEdgeGap = first
    ? Math.round(first.getBoundingClientRect().left - board.getBoundingClientRect().left - gutterLeft)
    : null;

  board.scrollTo({ left: board.scrollWidth, behavior: 'auto' });
  await settle();
  const endOffSnap = offSnap();
  const lastEdgeGap = last
    ? Math.round(
        board.getBoundingClientRect().left +
          board.clientWidth -
          gutterRight -
          last.getBoundingClientRect().right
      )
    : null;

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
    requests: window.__requests.map((r) => r.method + ' ' + r.path),
    drift, resting, landed, afterWheel,
    swipeOne, swipeFar, swipeBack, swipeShort, swipeVertical, afterBareScrollEnd,
    chained, walked, intoLastColumn, afterPinch,
    beforeInsert, afterInsert,
    columnBeforeAppend, columnAfterAppend, columnBeforePrepend, columnAfterPrepend,
    snapTargets: targets.length,
    snapStopAll: targets.every((el) => getComputedStyle(el).scrollSnapStop === 'always'),
    touchAction: getComputedStyle(board).touchAction,
    restingOffSnap, landedOffSnap, endOffSnap,
    firstEdgeGap, lastEdgeGap,
    step: board.clientWidth,
  };
})()`;

function checkScroll(s, mobile) {
  const f = [];
  // Scrolling a board is reading it, and a column arriving over the wire is the
  // server talking to us — neither is a reason to talk back.
  if (s.requests.length) f.push(`scrolling the board hit the server (${s.requests.join(', ')})`);
  if (s.drift > 2) f.push(`board drifted ${s.drift}px after arrival with no input`);
  if (mobile && s.resting > 2) f.push(`board did not arrive at the first column (${s.resting})`);
  if (Math.abs(s.afterWheel - s.landed) > 2)
    f.push(`untouched scroll was paginated (landed=${s.landed} -> ${s.afterWheel})`);
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
  // A vertical gesture belongs to the column's card list at every width.
  if (Math.abs(s.swipeVertical.after - s.swipeVertical.before) > 2)
    f.push(`a vertical gesture moved the board sideways (${s.swipeVertical.after})`);
  // The ends of the board sit against its edges, one gutter in — no blank canvas
  // in front of the first column or behind the last. This is the reading the
  // percentage side padding used to break: 51px of it on a 390px phone.
  if (s.firstEdgeGap > 2)
    f.push(`blank canvas in front of the first column (${s.firstEdgeGap}px past the gutter)`);
  if (s.lastEdgeGap > 2)
    f.push(`blank canvas behind the last column (${s.lastEdgeGap}px past the gutter)`);
  if (mobile) {
    // The whole point: a swipe advances exactly one column, and a drag long enough
    // to cross two still advances one. The browser no longer chooses.
    //
    // Stated in snap-target INDICES, not scroll deltas. Every swipe here starts
    // from the same place, so a delta measured against another delta cancels out
    // the one error that matters most — the board counting from the wrong target.
    // Both readings then move by the same wrong amount and agree with each other
    // while the board skips a column. Only an absolute index can say so, and only
    // at a width where more than one column fits, which is why the case list below
    // does not go straight from one column to none.
    const step = (name, gesture, expected) => {
      if (gesture.indexBefore !== 0) {
        f.push(`${name} did not start from the first column (${gesture.indexBefore})`);
      } else if (gesture.indexAfter !== expected) {
        f.push(
          `${name} landed on target ${gesture.indexAfter}, wanted ${expected} (${JSON.stringify(gesture)})`
        );
      }
    };
    step('a swipe', s.swipeOne, 1);
    step('a drag long enough to cross two columns', s.swipeFar, 1);
    step('a swipe back from the first column', s.swipeBack, 0);
    step('a drag too short to commit', s.swipeShort, 0);
    step('a vertical gesture', s.swipeVertical, 0);
    // ...and in pixels too where the expected position is known absolutely: the
    // first column's snap position is scrollLeft 0 by construction.
    if (Math.abs(s.swipeBack.after) > 2)
      f.push(`a swipe back from the first column moved it (${s.swipeBack.after})`);
    if (Math.abs(s.swipeShort.after) > 2)
      f.push(`a drag too short to commit still paged (${s.swipeShort.after})`);
    if (s.snapTargets < 2) f.push(`board exposed ${s.snapTargets} snap targets`);
    if (!s.snapStopAll) f.push('a snap target is missing scroll-snap-stop: always');
    // Without this the browser still owns the gesture, and everything above is
    // measuring native scrolling that happens to agree.
    if (!/\bpan-y\b/.test(s.touchAction) || /\bpan-x\b|auto|manipulation/.test(s.touchAction))
      f.push(`board touch-action is "${s.touchAction}" (want pan-y without pan-x)`);
    // The board must come to rest ON a snap position, so re-arming snap after the
    // gesture is the no-op it should be rather than a second, visible jump.
    if (s.restingOffSnap > 2) f.push(`board rests between columns (off by ${s.restingOffSnap}px)`);
    if (s.landedOffSnap > 2) f.push(`board settled between columns (off by ${s.landedOffSnap}px)`);
    // Snap-target tracking is what keeps the user's column under them when one
    // arrives ahead of it. A non-snapping board holds its offset instead and
    // silently shows them the previous column — which is why this is mobile-only.
    if (s.columnAfterPrepend !== s.columnBeforePrepend)
      f.push(
        `a column arriving before the viewed one displaced it (${s.columnBeforePrepend} -> ${s.columnAfterPrepend})`
      );
    // Two swipes in quick succession are two columns. The second one used to be
    // dropped outright — the board reads as "desktop" while it is sliding — and
    // dropped with snap suspended, which is the state anything else that moves it
    // moves it in.
    if (s.chained.index !== 2)
      f.push(`a swipe during the last one's slide landed on ${s.chained.index}, wanted 2`);
    if (s.chained.off > 2) f.push(`chained swipes left the board off-snap (${s.chained.off}px)`);
    // Every target in order, none twice, ending on the last. A dropped swipe shows
    // up here as a repeat; one that carries two columns as a gap.
    const wanted = s.walked.visited.map((_, i) => Math.min(i, s.snapTargets - 1));
    if (s.walked.visited.join() !== wanted.join())
      f.push(`walking the board visited ${s.walked.visited.join(',')}, wanted ${wanted.join(',')}`);
    if (s.walked.off > 2) f.push(`the walk left the board off-snap (${s.walked.off}px)`);
    // The reported bounce, at the one place it was reported: the last real column,
    // with the "+ Add column" tile one snap position behind it.
    if (s.intoLastColumn.index !== s.intoLastColumn.want)
      f.push(
        `a swipe into the last column landed on ${s.intoLastColumn.index}, wanted ${s.intoLastColumn.want}`
      );
    if (s.intoLastColumn.off > 2)
      f.push(`the last column is not a resting place (off by ${s.intoLastColumn.off}px)`);
    // A pinch must cost the board nothing beyond the gesture it refused.
    if (s.afterPinch.snap !== 'x mandatory')
      f.push(`a second finger left scroll-snap-type=${s.afterPinch.snap}`);
    if (s.afterPinch.to !== s.afterPinch.from + 1)
      f.push(
        `the swipe after a pinch went ${s.afterPinch.from} -> ${s.afterPinch.to} (wanted one column)`
      );
    // Scrolled to the far end, the board must be ON that end's snap position and
    // not merely clamped against the scroll range with a real snap position it
    // cannot reach — which is what a centered last target with no trailing canvas
    // leaves, and what mandatory snap then resolves onto some other column.
    if (s.endOffSnap > 2) f.push(`the end of the board is not a snap position (${s.endOffSnap}px)`);
  } else if (Math.abs(s.swipeFar.after - s.swipeFar.before) > 2) {
    f.push(`a swipe moved a board that does not snap (${s.swipeFar.after})`);
  }
  return f;
}

const SCROLL_CASES = [
  { w: 390, h: 844, cols: 12, tasks: 3 },
  // A phone in landscape. Below md, so the columns still mix their alignment and
  // the board still owns the gesture — but wide enough for two columns at once,
  // which 390 is not. That gap is where "which target is the board on?" stops
  // being answerable by looking at what is nearest the middle of the screen: at
  // rest on the first column, the SECOND one is nearer the middle (86px against
  // 214px). Between 390 and 1280 the check used to ask nothing at all.
  { w: 740, h: 900, cols: 12, tasks: 3 },
  { w: 1280, h: 800, cols: 12, tasks: 3 },
];

function scrollName(c) {
  return `scroll/${c.w < 1024 ? 'mobile' : 'desktop'} ${c.w}x${c.h} cols=${c.cols}`;
}

async function runScrollCases(probeUrl, { mustPass, include = () => true }) {
  let bad = 0;
  for (const c of SCROLL_CASES) {
    const mobile = c.w < 1024;
    const name = scrollName(c);
    if (!include(c, mobile) || !only.wants(name)) {
      continue;
    }
    await setViewport({ width: c.w, height: c.h, mobile });
    await goto(`${probeUrl}?cols=${c.cols}&tasks=${c.tasks}`, { wait: 700 });
    const s = await evalPage(SCROLL_PROBE);
    const failures = checkScroll(s, mobile);
    const passed = failures.length === 0;
    if (passed === mustPass) {
      console.log(
        `  ✓ ${name} (${mustPass ? JSON.stringify(s) : `should fail -> ${failures[0]}`})`
      );
      continue;
    }
    bad++;
    console.log(`  ✗ ${name}${mustPass ? '' : ': should fail -> passed'}`);
    for (const x of failures) console.log(`      - ${x}`);
    console.log(`      metrics: ${JSON.stringify(s)}`);
  }
  return bad;
}

console.log('\ncheck:layout:real — board scroll behavior');
failed += await runScrollCases(PROBE, { mustPass: true });

// --- Card drags: which column a drop lands in ---
// svelte-dnd-action hit-tests the CENTER of the floating card by default, not the
// pointer. A card is nearly as wide as its column here, so grabbing one anywhere
// but the middle puts its center up to half a column from the finger — enough to
// have the finger well inside the next column while the center is still in this
// one, whereupon the drop bounces back to where it started. `useCursorForDetection`
// on the task zone is what makes the finger decide, and this is the only check
// that can see it: jsdom lays nothing out, so every coordinate above is fiction
// there, and the unit test can only assert the option is passed, not that it works.
//
// Every case grabs the card near its RIGHT edge and drags right. That is the
// asymmetry the bug lives in — the center trails the finger — and a mid-card grab
// would pass either way.
const DRAG_PROBE = `(async (c) => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const span = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; };
  const lists = () => [...document.querySelectorAll('[data-task-list]')].map((l) => ({ id: l.dataset.taskList, ...span(l) }));
  // The list under a point, ignoring the floating card itself — it sits under the
  // pointer at every moment of the drag and would answer for every query.
  const under = (x, y) => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest('#dnd-action-dragged-el')) continue;
      const list = el.closest('[data-task-list]');
      if (list) return list.dataset.taskList;
    }
    return null;
  };

  const originList = document.querySelector('[data-task-list]');
  const card = originList.querySelector('[data-task-id]');
  const cr = card.getBoundingClientRect();
  const origin = originList.dataset.taskList;
  const taskId = card.dataset.taskId;
  const grabX = Math.round(cr.right - 16);
  const grabY = Math.round(cr.top + cr.height / 2);

  const touch = (target, type, x, y) => {
    const t = new Touch({ identifier: 1, target: card, clientX: x, clientY: y });
    target.dispatchEvent(new TouchEvent(type, {
      bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [t],
      changedTouches: [t],
    }));
  };
  const mouse = (target, type, x, y) =>
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
  // Moves go to document, not window: the board's edge auto-scroller listens on
  // document in capture and the drag library on window, and only an event that
  // bubbles reaches both the way a real one does.
  const down = (x, y) => (c.pointer === 'touch' ? touch(card, 'touchstart', x, y) : mouse(card, 'mousedown', x, y));
  const move = (x, y) => (c.pointer === 'touch' ? touch(document, 'touchmove', x, y) : mouse(document, 'mousemove', x, y));
  const up = (x, y) => (c.pointer === 'touch' ? touch(document, 'touchend', x, y) : mouse(document, 'mouseup', x, y));

  down(grabX, grabY);
  // A touch drag arms on a timer (TOUCH_DRAG_DELAY_MS), and moving before it
  // elapses cancels the drag and scrolls the page instead — so this waits it out
  // rather than racing it. A mouse drag arms on the first move.
  if (c.pointer === 'touch') await pause(320);
  const armed = !!document.getElementById('dnd-action-dragged-el') || c.pointer === 'mouse';

  const steps = Math.max(1, Math.round(Math.abs(c.toX - grabX) / 12));
  for (let i = 1; i <= steps; i++) {
    move(Math.round(grabX + ((c.toX - grabX) * i) / steps), grabY);
    await pause(24);
  }
  // The drop zone is re-decided on a poll (~160ms at this flip duration), not per
  // move, and the drop commits to whatever that poll last said. Holding still for
  // longer than one interval is what a finger pausing before it lifts does.
  await pause(c.hold);

  const dragged = document.getElementById('dnd-action-dragged-el');
  const dr = dragged && dragged.getBoundingClientRect();
  const at = {
    armed,
    origin,
    taskId,
    underFinger: under(c.toX, grabY),
    cardCenter: dr && Math.round((dr.left + dr.right) / 2),
    lists: lists(),
  };

  up(c.toX, grabY);
  await pause(700);

  const el = document.querySelector('[data-task-id="' + taskId + '"]');
  const isMove = (r) => r.method === 'PATCH' && r.path === '/api/tasks/' + taskId;
  return {
    ...at,
    landed: el ? el.closest('[data-task-list]').dataset.taskList : null,
    // The column the board asked the server for, not the one a stub was told to
    // remember: this is the real moveTask, placement and all, so a drop that
    // lands right on screen but writes the wrong column still fails here.
    moved: window.__requests.filter(isMove).map((r) => r.body && r.body.column_id),
    other: window.__requests.filter((r) => !isMove(r)).map((r) => r.method + ' ' + r.path),
  };
})`;

function checkDrag(d) {
  const f = [];
  // Without this every assertion below is vacuous: a gesture that never became a
  // drag leaves the card where it was, which is also what a bounced drop looks like.
  if (!d.armed) f.push('the press never armed a drag (no floating card)');
  // Guards the probe, not the board: if the finger did not actually reach another
  // column, "landed where the finger was" is true for free.
  if (d.underFinger === null) f.push(`the finger ended over no column at all (x=${d.toX})`);
  else if (d.underFinger === d.origin)
    f.push(`the drag never left ${d.origin} — probe geometry is wrong, not the board`);
  else {
    if (d.landed !== d.underFinger)
      f.push(`dropped into ${d.landed} with the finger over ${d.underFinger}`);
    if (d.moved.length !== 1 || d.moved[0] !== d.underFinger)
      f.push(
        `board moved the task to [${d.moved.join(',')}] (want one PATCH, to ${d.underFinger})`
      );
  }
  if (d.other.length) f.push(`a drop made requests beyond its own move (${d.other.join(', ')})`);
  return f;
}

// `hold` is per case because the board scrolls under a finger parked in its edge
// band, and on a phone the next column's only visible sliver IS in that band:
// hold too long and a further column has arrived under the finger, which is a
// different question than the one being asked here.
const DRAG_CASES = [
  { w: 768, h: 900, cols: 4, tasks: 3, pointer: 'touch', toX: 350, hold: 400 }, // two columns fully visible, no auto-scroll
  { w: 390, h: 844, cols: 4, tasks: 3, pointer: 'touch', toX: 370, hold: 260 }, // phone: release over the next column's sliver
  { w: 1280, h: 800, cols: 4, tasks: 3, pointer: 'mouse', toX: 600, hold: 400 }, // same rule for a mouse
];

function dragName(c) {
  return `drag/${c.w}x${c.h} ${c.pointer}`;
}

async function runDragCases(probeUrl, { mustPass }) {
  let bad = 0;
  for (const c of DRAG_CASES) {
    const name = dragName(c);
    if (!only.wants(name)) {
      continue;
    }
    await setViewport({ width: c.w, height: c.h, mobile: c.w < 1024 });
    await goto(`${probeUrl}?cols=${c.cols}&tasks=${c.tasks}`, { wait: 700 });
    const d = await evalPage(`(${DRAG_PROBE})(${JSON.stringify(c)})`);
    const failures = checkDrag({ ...d, toX: c.toX });
    const passed = failures.length === 0;
    if (passed === mustPass) {
      const how = mustPass
        ? `${d.origin} -> ${d.landed}, card center at ${d.cardCenter}`
        : `should fail -> ${failures[0]}`;
      console.log(`  ✓ ${name} (drag to x=${c.toX}: ${how})`);
      continue;
    }
    bad++;
    console.log(`  ✗ ${name}${mustPass ? '' : ': should fail -> passed'}`);
    for (const x of failures) console.log(`      - ${x}`);
    console.log(`      metrics: ${JSON.stringify(d)}`);
  }
  return bad;
}

console.log('\ncheck:layout:real — card drop targeting');
failed += await runDragCases(PROBE, { mustPass: true });

// Put the board back on a bug, so the phase that catches it can be shown to. Each
// substitution must apply EXACTLY once: without that count the selftest passes by
// rewriting nothing the day the code it names is renamed — the same failure it
// exists to catch, wearing the check's own face.
function regression(name, substitutions) {
  const applied = substitutions.map(() => 0);
  return {
    plugin: {
      name: `probe-selftest-${name}`,
      // Ahead of the svelte plugin, so this still sees the component's source.
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith('src/routes/Board.svelte')) {
          return null;
        }
        return substitutions.reduce((source, [from, to], index) => {
          const next = source.replace(from, to);
          if (next !== source) {
            applied[index]++;
          }
          return next;
        }, code);
      },
    },
    report() {
      return applied
        .map((count, index) =>
          count === 1
            ? null
            : `rewrote "${substitutions[index][0]}" ${count} times (want exactly 1)`
        )
        .filter(Boolean);
    },
  };
}

// `covers` is the case names this regression proves something about. A selftest
// arm is only meaningful for a phase that actually ran, and booting a second vite
// server to re-run cases the filter excluded is pure cost — so a filtered run
// skips the arms it cannot speak for.
async function runRegression({ plugin, report }, covers, phase) {
  if (!only.wantsAny(covers)) {
    return 0;
  }
  const server = await startServer([plugin]);
  const probe = new URL('scripts/board-probe.html', server.resolvedUrls.local[0]).href;
  let bad = await phase(probe);
  for (const problem of report()) {
    bad++;
    console.log(`  ✗ the selftest ${problem}`);
  }
  await server.close();
  return bad;
}

if (SELFTEST) {
  // Sensitivity proof. A green run that stays green with the fix removed is
  // measuring the harness, not the board.
  console.log('\ncheck:layout:real --selftest — sensitivity');

  // The drop phase rests on one option, and an option is exactly the kind of
  // thing a refactor drops without a word: a board back on the library's default
  // — the CENTER of the dragged card decides, not the pointer — must make every
  // case fail.
  failed += await runRegression(
    regression('center-detection', [
      ['useCursorForDetection: true', 'useCursorForDetection: false'],
    ]),
    DRAG_CASES.map(dragName),
    (probe) => runDragCases(probe, { mustPass: false })
  );

  // ...and the scroll phase on the board being able to tell its own suspension of
  // scroll-snap apart from the breakpoint that has none. Reading the computed
  // style back conflates the two, and dropping the release with it strands the
  // suspension for good. Desktop is excluded: it does not snap, so none of the
  // chaining assertions apply there and the case legitimately passes.
  failed += await runRegression(
    // Both halves in one anchored substitution: the guard reading the computed
    // style back, and the refusal that dropped the gesture without releasing the
    // suspension. Anchored on one line rather than spanning several, because a
    // reflow by the formatter is exactly what makes a multi-line anchor match
    // nothing — which is what the count below is here to catch, and did.
    regression('snap-suspension', [
      [
        '!boardSnaps(scroller)) {\n        abandon();',
        "getComputedStyle(scroller).scrollSnapType === 'none') {\n        swipe = null;",
      ],
    ]),
    SCROLL_CASES.filter((c) => c.w < 1024).map(scrollName),
    (probe) => runScrollCases(probe, { mustPass: false, include: (_case, mobile) => mobile })
  );
}

await close();
await teardown();
// After every phase has been offered its cases, so `--list` and the
// matched-nothing error can enumerate them; before the exit code, so a filter
// that selected nothing cannot leave through the success door below.
only.finish('check:layout:real');
if (failed > 0) {
  console.log(`\ncheck:layout:real — FAILED (${failed})`);
  process.exit(1);
}
console.log(`\ncheck:layout:real — ${only.summary('passed')}`);
process.exit(0);
