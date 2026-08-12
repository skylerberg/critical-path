// Headless-browser helper for the layout checks and ad-hoc repro, backed by
// Playwright. Exposes the same minimal surface the old hand-rolled CDP helper
// did — createBrowser() -> { setViewport, goto, eval, screenshot, close } — so
// the check scripts and the browser-repro workflow don't change shape, only the
// engine underneath. Playwright owns the hard parts the hand-rolled version got
// wrong: robust launch, orphan killing, and per-platform flags.
//
//   import { createBrowser } from './lib/browser.mjs';
//   const browser = await createBrowser();
//   if (!browser) { console.warn('no browser'); process.exit(0); } // local-only skip
//   await browser.setViewport({ width: 390, height: 844, mobile: true });
//   await browser.goto('http://localhost:5180/scripts/board-probe.html?cols=4');
//   const sw = await browser.eval('document.documentElement.scrollWidth');
//   await browser.close();
//
// `engine: 'webkit'` runs the same probe under WebKit, which is the engine on
// every iOS browser and the one this app's bug reports come from. It is worth
// reaching for whenever a question is about focus, the on-screen keyboard, or
// what an unmount does to a focused field — the places Chromium and WebKit have
// historically disagreed, and where believing Chromium alone has been wrong.
// Nothing committed runs under it today: the layout checks are Chromium-only, so
// CI installs only Chromium, and a committed check that asked for WebKit would
// fail loudly there rather than skip.
//
// createBrowser() returns null only when run locally without that engine
// installed (so a dev who hasn't run `npm run playwright:install` isn't
// blocked). In CI (process.env.CI set) a launch failure is a real error and is
// thrown, so the layout gate can't be silently bypassed by a missing browser.

import { chromium, webkit } from 'playwright';

const ENGINES = { chromium, webkit };

/**
 * Launch a headless browser and return a small measurement helper.
 * @param {{headless?: boolean, engine?: 'chromium'|'webkit'}} [options]
 * @returns {Promise<{setViewport, goto, eval, screenshot, close}|null>}
 */
export async function createBrowser({ headless = true, engine = 'chromium' } = {}) {
  const launcher = ENGINES[engine];
  if (!launcher) {
    throw new Error(`Unknown browser engine "${engine}" — expected chromium or webkit`);
  }
  let browser;
  try {
    browser = await launcher.launch({ headless });
  } catch (error) {
    if (process.env.CI) throw error;
    // Locally, a missing browser shouldn't block the rest of the checks — let the
    // caller print its own skip message (with the install command).
    return null;
  }

  // isMobile is a context-level setting in Playwright and can't change for the
  // lifetime of a context, so we recreate the context+page whenever the mobile
  // flag flips (mobile cases vs. the desktop case). Within one mode we just resize.
  let context = null;
  let page = null;
  let isMobile = null;

  async function ensureContext() {
    if (context === null) await applyViewport({ width: 1280, height: 720, mobile: false });
  }

  async function applyViewport({ width, height, mobile, deviceScaleFactor }) {
    if (context !== null && mobile === isMobile) {
      await page.setViewportSize({ width, height });
      return;
    }
    if (context !== null) await context.close();
    isMobile = mobile;
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: deviceScaleFactor ?? (mobile ? 2 : 1),
      // isMobile:true models the mobile layout viewport — the exact behavior the
      // mobile bottom-nav regression hinges on (overflow expands innerWidth).
      isMobile: mobile,
      hasTouch: mobile,
    });
    page = await context.newPage();
  }

  return {
    /** Emulate a device. `mobile: true` models mobile viewport behavior. */
    async setViewport({ width, height, mobile = true, deviceScaleFactor }) {
      await applyViewport({ width, height, mobile, deviceScaleFactor });
    },
    /** Navigate and wait briefly for render to settle. */
    async goto(url, { wait = 350 } = {}) {
      await ensureContext();
      await page.goto(url, { waitUntil: 'load' });
      if (wait) await page.waitForTimeout(wait);
    },
    /** Evaluate a JS expression in the page and return its value. */
    async eval(expression) {
      await ensureContext();
      return page.evaluate(expression);
    },
    /** Capture a PNG screenshot (Buffer). */
    async screenshot() {
      await ensureContext();
      return page.screenshot({ type: 'png' });
    },
    async close() {
      try {
        await context?.close();
      } catch {
        // already closed
      }
      try {
        await browser.close();
      } catch {
        // already gone
      }
    },
  };
}
