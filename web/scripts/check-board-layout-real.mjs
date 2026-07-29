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
// with exit 0 if Chrome isn't found. Exits non-zero on assertion failure.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createBrowser } from './lib/cdp.mjs';

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
  console.warn('check:layout:real — skipped (no Chrome/Chromium binary found).');
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
  const de = document.documentElement;
  return {
    cols: cols.length,
    vw: innerWidth,
    vh: innerHeight,
    htmlSW: de.scrollWidth,
    htmlSH: de.scrollHeight,
    boardSW: board?.scrollWidth,
    boardCW: board?.clientWidth,
    boardCH: board?.clientHeight,
    colH: cols.map((c) => Math.round(c.getBoundingClientRect().height)),
    navTop: nr && Math.round(nr.top),
    navW: nr && Math.round(nr.width),
  };
})()`;

function check(m, vp) {
  const f = [];
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
  return f;
}

const CASES = [
  { w: 390, h: 844, cols: 4, tasks: 2 }, // short columns -> still fill (no gap)
  { w: 390, h: 844, cols: 4, tasks: 40 }, // tall columns -> scroll internally
  { w: 390, h: 844, cols: 8, tasks: 20 }, // many columns -> horizontal scroll, no document overflow
  { w: 1280, h: 800, cols: 4, tasks: 12 }, // desktop: lg sidebar, no bottom nav
];

let failed = 0;
console.log('check:layout:real — real Board.svelte in headless Chrome');
for (const c of CASES) {
  const mobile = c.w < 1024;
  await setViewport({ width: c.w, height: c.h, mobile });
  await goto(`${PROBE}?cols=${c.cols}&tasks=${c.tasks}`, { wait: 700 });
  const m = await evalPage(MEASURE);
  // On desktop the bottom nav is display:none; allow navTop/navW to be undefined.
  const failures = mobile ? check(m, c) : check(m, c).filter((x) => !x.includes('nav'));
  const tag = `${mobile ? 'MOBILE' : 'DESKTOP'} ${c.w}x${c.h} cols=${c.cols} tasks=${c.tasks}`;
  if (failures.length) {
    failed++;
    console.log(`  ✗ ${tag}`);
    for (const x of failures) console.log(`      - ${x}`);
    console.log(`      metrics: ${JSON.stringify(m)}`);
  } else {
    console.log(`  ✓ ${tag} (htmlSW=${m.htmlSW}, navW=${m.navW})`);
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
