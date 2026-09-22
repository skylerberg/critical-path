import { onTestFinished } from 'vitest';

// Test-only, and in src/lib rather than beside the tests for the same reason as
// realtime-test-events.ts: tests in both src/lib and src/components import it.

/**
 * Gives jsdom the clipboard it does not have, for the length of one test.
 *
 * The obvious spelling — `vi.stubGlobal('navigator', { ...navigator, clipboard })` —
 * is a trap twice over. Spreading navigator produces a plain object without its
 * prototype getters, userAgent among them, and Tiptap reads userAgent at editor
 * mount and again when a focus command lands — so the stub broke tests that
 * never touched the clipboard. And the matching cleanup, `vi.unstubAllGlobals()`,
 * is the last line a failing assertion skips *and* restores the globals
 * testUtils installs at import time along with it. Defining the one property in
 * place avoids all of that, and registering the cleanup here means a failing
 * assertion cannot leak the stub into the cases that follow it.
 */
export function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  // jsdom's own navigator has no clipboard at all, so restoring is deleting.
  onTestFinished(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });
}
