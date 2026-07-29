// Minimal headless-Chrome DevTools Protocol helper — zero dependencies (uses
// Node's built-in WebSocket and fetch). For measuring real layout that jsdom
// cannot (it has no box model).
//
//   import { createBrowser, findChrome } from './lib/cdp.mjs';
//   const browser = await createBrowser();
//   if (!browser) { console.warn('no Chrome'); process.exit(0); }
//   await browser.setViewport({ width: 390, height: 844, mobile: true });
//   await browser.goto('http://localhost:5173/board-probe.html?cols=4');
//   const sw = await browser.eval('document.documentElement.scrollWidth');
//   browser.close();
//
// createBrowser() returns null if no Chrome/Chromium binary is found so callers
// can decide whether to skip (CI gates) or error (ad-hoc repro).

import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

/** Find a Chrome/Chromium binary on macOS/Linux, else via PATH. null if none. */
export function findChrome() {
  for (const c of CANDIDATES) if (existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const p = execSync(`command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (p) return p;
    } catch {
      // not on PATH; try next candidate
    }
  }
  return null;
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Launch headless Chrome and open a CDP session.
 * @returns {Promise<{cdp, setViewport, goto, eval, screenshot, close}|null>}
 */
export async function createBrowser({ chromePath, extraArgs = [], headless = true } = {}) {
  const bin = chromePath ?? findChrome();
  if (!bin) return null;

  const port = await freePort();
  const browser = spawn(
    bin,
    [
      headless ? '--headless=new' : '',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      ...extraArgs.filter(Boolean),
      'about:blank',
    ].filter(Boolean),
    { stdio: ['ignore', 'ignore', 'ignore'] }
  );

  let ws;
  let nextId = 1;
  const pending = new Map();
  /** Raw CDP call. */
  function cdp(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout connecting to Chrome')), 15000);
    const poll = async () => {
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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
        sock.onerror = (e) => reject(new Error(`CDP socket: ${e?.message ?? 'error'}`));
        sock.onopen = () => resolve(sock);
      } catch {
        setTimeout(poll, 100);
      }
    };
    poll();
  });

  await cdp('Page.enable');
  await cdp('Runtime.enable');

  const close = () => {
    try {
      ws.close();
    } catch {
      // already closed
    }
    try {
      browser.kill();
    } catch {
      // already gone
    }
  };
  process.on('exit', close);

  return {
    cdp,
    close,
    /** Emulate a device. `mobile: true` models mobile viewport behavior (incl. layout-viewport expansion on overflow). */
    async setViewport({ width, height, mobile = true, deviceScaleFactor }) {
      await cdp('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: deviceScaleFactor ?? (mobile ? 2 : 1),
        mobile,
        screenWidth: width,
        screenHeight: height,
      });
    },
    /** Navigate and wait briefly for render. */
    async goto(url, { wait = 350 } = {}) {
      await cdp('Page.navigate', { url });
      if (wait) await new Promise((r) => setTimeout(r, wait));
    },
    /** Evaluate a JS expression in the page and return its value. */
    async eval(expression, { returnByValue = true } = {}) {
      const { result } = await cdp('Runtime.evaluate', { expression, returnByValue });
      return result.value;
    },
    /** Capture a PNG screenshot (base64). */
    async screenshot() {
      const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },
  };
}
