#!/usr/bin/env node
// Real-component layout check: mounts the ACTUAL Board.svelte (via
// scripts/board-probe.html) in headless Chrome and asserts the mobile layout
// invariants. Complements scripts/check-board-layout.mjs (which checks a
// hand-authored fixture): this catches bugs the fixture can't model (real
// Tailwind output, real svelte-dnd-action, real component structure).
//
//   npm run check:layout:real
//
// Boots `vite dev` on a fixed port, waits for it, measures, tears down. Skips
// with exit 0 if Chromium isn't installed. Exits non-zero on assertion failure.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createBrowser } from './lib/browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname); // repo root (worktree root)
const PORT = Number(process.env.VITE_PORT ?? '5180');
const PROBE = `http://127.0.0.1:${PORT}/scripts/board-probe.html`;

// --- boot vite dev ---
const vite = spawn(
  process.execPath,
  [
    join('node_modules', 'vite', 'bin', 'vite.js'),
    '--port',
    String(PORT),
    '--strictPort',
    '--host',
    '127.0.0.1',
  ],
  { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] }
);
vite.on('exit', (code) => {
  if (!tearingDown && code !== null) {
    console.error(`check:layout:real — vite exited unexpectedly (code ${code})`);
    process.exit(1);
  }
});

async function waitForVite() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(PROBE, { method: 'head' });
      if (res.ok || res.status === 200 || res.status === 404) return; // server is up (404 = up, wrong path)
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite did not start on port ${PORT} within 30s`);
}

let tearingDown = false;
const teardown = () => {
  tearingDown = true;
  try {
    vite.kill();
  } catch {
    // already gone
  }
};
process.on('exit', teardown);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

await waitForVite();

const browser = await createBrowser();
if (!browser) {
  console.warn('check:layout:real — skipped (Playwright Chromium not installed).');
  console.warn('  Run `npx playwright install chromium`.');
  teardown();
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
console.log('check:layout:real — real Board.svelte in headless Chrome');
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

// --- Scroll behaviour ---
// The board must move only when the user moved it. jsdom models no scrolling at
// all, so these are the only tests that can see the real thing: whether it drifts
// on arrival, and whether a scroll the user did not make with a finger gets
// paginated back. A real wheel would need page.mouse.wheel, which the browser
// helper doesn't expose; a programmatic scrollTo is a faithful stand-in because
// the bug is precisely that the board cannot tell the two apart.
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

  board.scrollTo({ left: 0, behavior: 'auto' });
  await settle();
  board.dispatchEvent(new Event('touchstart'));
  jump();
  await settle();
  await pause(700);
  const afterTouch = board.scrollLeft;

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
  board.scrollTo({ left: 0, behavior: 'auto' });
  await settle();
  const firstOffCenter = targets.length ? offBy(targets[0]) : null;
  board.scrollTo({ left: board.scrollWidth, behavior: 'auto' });
  await settle();
  const lastOffCenter = targets.length ? offBy(targets[targets.length - 1]) : null;

  return {
    drift, resting, landed, afterWheel, afterTouch,
    snapTargets: targets.length,
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
  if (mobile) {
    // The guardrail must still be alive where scroll-snap-stop can be ignored:
    // one column advanced, not the two and a half the scroll asked for.
    if (s.afterTouch >= s.afterWheel - 2)
      f.push(`touch swipe was not capped at one column (${s.afterTouch} of ${s.afterWheel})`);
    if (s.afterTouch <= 2) f.push(`touch swipe advanced nothing (${s.afterTouch})`);
    // Phones center their columns, so scrolling to either end must land the end
    // target dead center. A non-zero reading is space the layout never made.
    if (s.snapTargets < 2) f.push(`board exposed ${s.snapTargets} snap targets`);
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

console.log('\ncheck:layout:real — board scroll behaviour');
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

close();
teardown();
if (failed > 0) {
  console.log(`\ncheck:layout:real — FAILED (${failed})`);
  process.exit(1);
}
console.log('\ncheck:layout:real — passed');
process.exit(0);
