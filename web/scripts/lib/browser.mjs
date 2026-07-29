// Headless-Chrome helper for the layout checks and ad-hoc repro, backed by
// Playwright. Exposes the same minimal surface the old hand-rolled CDP helper
// did — createBrowser() -> { setViewport, goto, eval, screenshot, close } — so
// the check scripts and the browser-repro workflow don't change shape, only the
// engine underneath. Playwright owns the hard parts the hand-rolled version got
// wrong: robust launch, orphan killing, and per-platform flags.
//
//   import { createBrowser } from './lib/browser.mjs';
//   const browser = await createBrowser();
//   if (!browser) { console.warn('no Chromium'); process.exit(0); } // local-only skip
//   await browser.setViewport({ width: 390, height: 844, mobile: true });
//   await browser.goto('http://localhost:5180/scripts/board-probe.html?cols=4');
//   const sw = await browser.eval('document.documentElement.scrollWidth');
//   await browser.close();
//
// createBrowser() returns null only when run locally without Chromium installed
// (so a dev who hasn't run `npx playwright install chromium` isn't blocked). In
// CI (process.env.CI set) a launch failure is a real error and is thrown, so the
// layout gate can't be silently bypassed by a missing browser.

import { chromium } from 'playwright';

/**
 * Launch headless Chromium and return a small measurement helper.
 * @returns {Promise<{setViewport, goto, eval, screenshot, close}|null>}
 */
export async function createBrowser({ headless = true } = {}) {
  let browser;
  try {
    browser = await chromium.launch({ headless });
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
