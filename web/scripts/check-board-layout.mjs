#!/usr/bin/env node
// Real-layout regression check for the board / bottom-nav on mobile.
//
// jsdom (the vitest environment) has no layout engine, so the existing tests
// cannot catch the bug this guards: the fixed bottom nav being pushed off-screen,
// or a gap opening below the columns. This script drives a real headless Chrome
// via the DevTools Protocol (Node's built-in WebSocket — no dependencies) and
// asserts the board layout invariants at a mobile viewport.
//
//   node scripts/check-board-layout.mjs            # gate (used by `check:layout`)
//   node scripts/check-board-layout.mjs --selftest # also prove the test is sensitive
//
// Exits non-zero on any assertion failure. If no Chrome binary is found it exits
// 0 with a warning so environments without Chrome (e.g. some dev machines) are not
// blocked; CI (ubuntu-latest) ships Chrome.
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = pathToFileURL(join(__dirname, 'board-layout.fixture.html')).href;

// --- discover a Chrome/Chromium binary (macOS, Linux, Windows) ---
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  // Fall back to a PATH lookup.
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const p = execSync(`command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (p) return p;
    } catch {
      // binary not on PATH; try the next candidate
    }
  }
  return null;
}

const CHROME = findChrome();
if (!CHROME) {
  console.warn('check:layout — skipped (no Chrome/Chromium binary found).');
  process.exit(0);
}

// --- launch Chrome with a CDP endpoint ---
const PORT = 0 + (process.env.CDP_PORT ? Number(process.env.CDP_PORT) : 0) || 9361;
const browser = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore'] }
);
let ws;
const cleanup = () => {
  try {
    ws?.close();
  } catch {
    // teardown races are irrelevant
  }
  try {
    browser.kill();
  } catch {
    // process may already be gone
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

let nextId = 1;
const pending = new Map();
function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

ws = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('timeout connecting to Chrome')), 10000);
  const poll = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (!page) throw new Error('no page target');
      clearTimeout(timeout);
      const sock = new WebSocket(page.webSocketDebuggerUrl);
      sock.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
          const { resolve, reject } = pending.get(msg.id);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      sock.onerror = (e) => reject(new Error(String(e?.message ?? 'ws error')));
      sock.onopen = () => resolve(sock);
    } catch {
      setTimeout(poll, 100);
    }
  };
  poll();
});

await cdp('Page.enable');
await cdp('Runtime.enable');

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'small', width: 360, height: 640 },
];

const MEASURE = `(() => {
  const scroller = document.querySelector('[data-board-scroller]');
  const row = document.querySelector('[data-row]');
  const nav = document.querySelector('[data-bottom-nav]');
  const cols = [...document.querySelectorAll('section')];
  const list = document.querySelector('section [aria-label$="tasks"]');
  const sr = scroller.getBoundingClientRect();
  const nr = nav.getBoundingClientRect();
  const de = document.documentElement;
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    boardClientH: scroller.clientHeight,
    boardScrollH: scroller.scrollHeight,
    boardScrollW: scroller.scrollWidth,
    boardClientW: scroller.clientWidth,
    htmlScrollH: de.scrollHeight,
    htmlScrollW: de.scrollWidth,
    boardBottom: Math.round(sr.bottom),
    navTop: Math.round(nr.top),
    navWidth: Math.round(nr.width),
    colH: cols.map((c) => Math.round(c.getBoundingClientRect().height)),
    rowIsFlex: getComputedStyle(row).flexGrow !== '0' || getComputedStyle(row).flexBasis !== '0px',
    listScrolls: list ? list.scrollHeight > list.clientHeight + 2 : null,
  };
})()`;

async function render(query, viewport) {
  await cdp('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp('Page.navigate', { url: `${FIXTURE}?${query}` });
  await new Promise((r) => setTimeout(r, 300));
  const { result } = await cdp('Runtime.evaluate', {
    expression: MEASURE,
    returnByValue: true,
  });
  return result.value;
}

// Invariants the fixed layout must satisfy at every size / column / task count.
// `expectInternalScroll` is true only for cases where the task list is tall enough
// that it MUST scroll inside its column rather than grow the board.
function checkInvariants(m, viewport, expectInternalScroll) {
  const failures = [];
  // Columns fill the board height (no gap below them).
  if (!m.colH.every((h) => h >= m.boardClientH - 28 && h <= m.boardClientH + 2)) {
    failures.push(
      `columns do not fill board (colH=${m.colH.join(',')} boardClientH=${m.boardClientH})`
    );
  }
  // Board never overflows vertically (nav can never be pushed off-screen).
  if (m.boardScrollH > m.boardClientH + 2) {
    failures.push(
      `board overflows vertically (scrollH=${m.boardScrollH} > clientH=${m.boardClientH})`
    );
  }
  // Page itself never overflows (no body scroll either way).
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
  // Bottom nav is on-screen and spans only the viewport width.
  if (m.navTop > viewport.height - 40) {
    failures.push(`bottom nav not visible (navTop=${m.navTop} vh=${viewport.height})`);
  }
  if (m.navWidth > viewport.width + 2) {
    failures.push(`bottom nav wider than screen (navWidth=${m.navWidth} vw=${viewport.width})`);
  }
  // Board still scrolls horizontally (the fix must not break column scrolling).
  if (m.boardScrollW <= m.boardClientW + 2) {
    failures.push(
      `board does not scroll horizontally (scrollW=${m.boardScrollW} clientW=${m.boardClientW})`
    );
  }
  // A tall task list scrolls inside its column, not the board.
  if (expectInternalScroll && m.listScrolls === false) {
    failures.push('tall task list does not scroll internally');
  }
  return failures;
}

const SELFTEST = process.argv.includes('--selftest');
const MATRIX = [
  { cols: 4, tasks: 2, expectInternalScroll: false }, // short columns -> must still fill (no gap)
  { cols: 4, tasks: 40, expectInternalScroll: true }, // tall columns -> scroll internally, not overflow
  { cols: 8, tasks: 12, expectInternalScroll: false }, // many columns -> horizontal scroll, no page overflow
];

let failed = 0;
console.log('check:layout — board + bottom-nav layout (real Chrome)');
for (const viewport of VIEWPORTS) {
  for (const { cols, tasks, expectInternalScroll } of MATRIX) {
    const m = await render(`cols=${cols}&tasks=${tasks}`, viewport);
    const failures = checkInvariants(m, viewport, expectInternalScroll);
    const tag = `${viewport.name} ${viewport.width}x${viewport.height} cols=${cols} tasks=${tasks}`;
    if (failures.length) {
      failed++;
      console.log(`  ✗ ${tag}`);
      for (const f of failures) console.log(`      - ${f}`);
    } else {
      console.log(`  ✓ ${tag}`);
    }
  }
}

if (SELFTEST) {
  // Sensitivity proof: under the mobile percentage-resolution failure (sim=1),
  // the FIXED markup still passes while the LEGACY markup must fail. This shows
  // the gate would have caught the original bug.
  console.log('\ncheck:layout --selftest — sensitivity (legacy must fail under mobile-sim)');
  const vp = VIEWPORTS[0];
  const fixed = await render('cols=4&tasks=40&sim=1', vp);
  const legacy = await render('cols=4&tasks=40&legacy=1&sim=1', vp);
  const fixedFailures = checkInvariants(fixed, vp, true);
  const legacyFailures = checkInvariants(legacy, vp, true);
  if (fixedFailures.length) {
    failed++;
    console.log('  ✗ fixed markup failed under mobile-sim (regression):');
    for (const f of fixedFailures) console.log(`      - ${f}`);
  } else {
    console.log('  ✓ fixed markup survives mobile-sim');
  }
  if (legacyFailures.length === 0) {
    failed++;
    console.log('  ✗ legacy markup passed under mobile-sim (test is not sensitive!)');
  } else {
    console.log(
      `  ✓ legacy markup fails under mobile-sim (${legacyFailures.length} invariant(s)) — test is sensitive`
    );
  }
}

cleanup();
if (failed > 0) {
  console.log(`\ncheck:layout — FAILED (${failed})`);
  process.exit(1);
}
console.log('\ncheck:layout — passed');
process.exit(0);
