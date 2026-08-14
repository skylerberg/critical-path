// Headless-browser helper for the layout checks and ad-hoc repro, backed by
// Playwright. Exposes the same minimal surface the old hand-rolled CDP helper
// did — createBrowser() -> { setViewport, goto, eval, press, screenshot, close } — so
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
// installed (so a dev who hasn't run `pnpm run playwright:install` isn't
// blocked). In CI (process.env.CI set) a launch failure is a real error and is
// thrown, so the layout gate can't be silently bypassed by a missing browser.

import { chromium, webkit } from 'playwright';

const ENGINES = { chromium, webkit };

// How long to let a navigation announce itself after an evaluate has died on it.
const NAVIGATION_SETTLE_MS = 500;

/**
 * Launch a headless browser and return a small measurement helper.
 * @param {{headless?: boolean, engine?: 'chromium'|'webkit'}} [options]
 * @returns {Promise<{setViewport, goto, eval, press, screenshot, close}|null>}
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
  let scheme = null;
  // Where `goto` last sent the page, and any main-frame navigation since — so
  // `eval` can tell a page that went somewhere on its own apart from one that
  // merely lost its execution context where it stood.
  let navigatedTo = null;
  let lastNavigation = null;

  async function ensureContext() {
    if (context === null) await applyViewport({ width: 1280, height: 720, mobile: false });
  }

  async function applyViewport({ width, height, mobile, deviceScaleFactor, colorScheme }) {
    const wanted = colorScheme ?? 'light';
    if (context !== null && mobile === isMobile && wanted === scheme) {
      await page.setViewportSize({ width, height });
      return;
    }
    if (context !== null) await context.close();
    isMobile = mobile;
    scheme = wanted;
    lastNavigation = null;
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: deviceScaleFactor ?? (mobile ? 2 : 1),
      // isMobile:true models the mobile layout viewport — the exact behavior the
      // mobile bottom-nav regression hinges on (overflow expands innerWidth).
      isMobile: mobile,
      hasTouch: mobile,
      // Context-level like isMobile, so flipping it discards the page too: the
      // palette is defined entirely under prefers-color-scheme, and half of it
      // only exists in the scheme this selects.
      colorScheme: wanted,
    });
    const created = await context.newPage();
    // Recorded as an EVENT rather than read back from `page.url()` when something
    // goes wrong: the context dies as a navigation commits, so at that moment the
    // url and the load state both still describe the page being left. Polling
    // them reports every navigation as "no navigation".
    created.on('framenavigated', (frame) => {
      if (frame === created.mainFrame()) {
        lastNavigation = frame.url();
      }
    });
    page = created;
  }

  const href = (url) => {
    try {
      return new URL(url).href;
    } catch {
      return url;
    }
  };

  return {
    /**
     * Emulate a device. `mobile: true` models mobile viewport behavior.
     * `colorScheme` drives prefers-color-scheme; like `mobile`, changing it
     * replaces the page, so navigate again afterwards.
     */
    async setViewport({ width, height, mobile = true, deviceScaleFactor, colorScheme }) {
      await applyViewport({ width, height, mobile, deviceScaleFactor, colorScheme });
    },
    /** Navigate and wait briefly for render to settle. */
    async goto(url, { wait = 350 } = {}) {
      await ensureContext();
      navigatedTo = href(url);
      await page.goto(url, { waitUntil: 'load' });
      // This navigation is ours; only what happens after it is the page's doing.
      lastNavigation = null;
      if (wait) await page.waitForTimeout(wait);
    },
    /**
     * Evaluate a JS expression in the page and return its value.
     *
     * "Execution context was destroyed" has two very different causes and
     * Playwright reports them identically, so this separates them before doing
     * anything else. If the page has moved off the URL it was sent to, the PAGE
     * navigated — a probe that trips a link measures the page it left, so that is
     * reported with both URLs and never retried. If it is still where it was put,
     * the JS world went away underneath it with no navigation of ours, which is a
     * harness-level hiccup: retried once, loudly, because the probe produced no
     * measurement at all and a second failure is a real problem.
     *
     * Seen twice on a laptop and never in CI, both times immediately after a
     * `goto`. Retrying is instrumentation for the next occurrence, not a
     * diagnosis of that one.
     */
    async eval(expression) {
      await ensureContext();
      try {
        return await page.evaluate(expression);
      } catch (error) {
        if (!/Execution context was destroyed/.test(String(error?.message))) {
          throw error;
        }
        // Both arrive just AFTER the evaluate rejects: the rejection IS the
        // context dying, and the navigation event is Playwright working out why a
        // moment later. Deciding immediately reads state that has not arrived and
        // calls every navigation "no navigation". Only runs on the failure path.
        await page.waitForTimeout(NAVIGATION_SETTLE_MS);
        const went = lastNavigation === null ? null : href(lastNavigation);
        if (went !== null && went !== navigatedTo) {
          throw new Error(
            `the page navigated while it was being measured: ${navigatedTo} -> ${went}. ` +
              `Not retried: a probe that causes a navigation is measuring the wrong page.`,
            { cause: error }
          );
        }
        console.warn(
          `browser.eval: lost the execution context${went === null ? '' : ' to a reload'} with the ` +
            `page still on ${navigatedTo}; retrying once.`
        );
        lastNavigation = null;
        return await page.evaluate(expression);
      }
    },
    /**
     * Press a key through the browser's real input pipeline, on whatever holds
     * focus — or on `selector`, focused first. `key` is Playwright's name for it:
     * 'Enter', 'Escape', 'Tab', 'ArrowDown', ' ' for space.
     *
     * The distinction from dispatching a KeyboardEvent inside `eval` is default
     * behaviour, and it is the whole point of having this. A synthetic event runs
     * listeners and nothing else: Tab does not move focus, space does not scroll
     * or click, a printable key puts no text in a field. Those are exactly the
     * things jsdom cannot model either, so a probe that hand-dispatches is back to
     * testing what the unit tests already cover. A library listening for the key
     * (svelte-dnd-action's keyboard drag, this app's shortcuts) reacts to either,
     * which is what makes the difference easy to miss.
     */
    async press(key, { selector } = {}) {
      await ensureContext();
      if (selector !== undefined) await page.focus(selector);
      await page.keyboard.press(key);
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
