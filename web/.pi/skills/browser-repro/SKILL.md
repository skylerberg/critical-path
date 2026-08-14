---
name: browser-repro
description: Reproduce and debug layout, focus and other bugs against the REAL component in a headless browser (measures what jsdom cannot — box model, focus, showModal, computed styles). Use for any layout issue — elements overflowing or off-screen, fixed/sticky nav misbehavior, unexplained gaps, mobile viewport/scroll problems — and for anything about focus or the on-screen keyboard, which wants WebKit as well as Chromium. Prevents the failure mode of diagnosing against an unfaithful hand-authored fixture.
---

# Browser repro for layout bugs

jsdom (the vitest environment) has **no box model** — it cannot catch layout
bugs, and a hand-authored fixture can pass while the real app fails (this is
exactly how the mobile bottom-nav bug shipped: a fixture without the real
component's absolutely-positioned children passed, while production broke). For
any layout/visual bug, reproduce against the **real component** in a real
browser before diagnosing.

Everything here rides on Playwright (already a dev dependency): it drives a
pinned headless Chromium via `scripts/lib/browser.mjs`. First-time local setup:
`npm run playwright:install` (downloads Chromium once).

## The tools (already in the repo)

- `scripts/lib/browser.mjs` — reusable helper: `createBrowser()`
  → `{ setViewport, goto, eval, press, screenshot, close }`. **Use this instead of
  writing Playwright boilerplate.**
- `scripts/board-probe.html` + `scripts/board-probe.ts` — mounts the **real**
  `Board.svelte` with seeded data inside an App/Project shell. Parametrized:
  `?cols=N&tasks=M&readonly=1`. Add analogous probes for other components.
- `scripts/check-board-layout.mjs` — fast gate against a faithful *fixture*
  (first line of defense; runs in CI as `check:layout`).
- `scripts/check-board-layout-real.mjs` — gate against the **real component**
  via the probe (boots `vite dev`, measures, tears down; CI: `check:layout:real`).
- `scripts/task-detail-probe.ts` + `scripts/check-task-detail.mjs` — the same
  shape around one component rather than a whole route, and the closer model to
  copy for a new probe. It asks what jsdom cannot answer about focus.

CLAUDE.md's "Checking what jsdom cannot model" is the owner of the engine
differences and the traps a new probe hits; read it before writing one.

## Workflow for a board/layout bug

1. **Reproduce first, theorize second.** Boot the real component and measure:

   ```js
   import { createBrowser } from './scripts/lib/browser.mjs';
   const b = await createBrowser();
   await b.setViewport({ width: 390, height: 844, mobile: true }); // mobile:true models mobile viewport behavior
   await b.goto('http://localhost:5180/scripts/board-probe.html?cols=4&tasks=12');
   const m = await b.eval(`(() => ({
     htmlSW: document.documentElement.scrollWidth,
     vw: innerWidth,
     navW: document.querySelector('nav[aria-label="Primary"]')?.getBoundingClientRect().width,
   }))()`);
   await b.close();
   ```

   (Run `npm run dev` on any free port first, e.g. `vite --port 5180 --strictPort`,
   or just `node scripts/check-board-layout-real.mjs` which does all of it.)

2. **If a metric is wrong, isolate the offending element** before guessing:
   - The element defining `document.documentElement.scrollWidth`: query elements
     whose `getBoundingClientRect().right` ≈ `scrollWidth`.
   - Containing block of an oddly-positioned element: read `el.offsetParent`
     (null/`body` ⇒ its containing block is the viewport — a common escape bug).
   - Hide candidates and re-measure (`el.style.display='none'`) to confirm cause.
   - A clipping ancestor only clips an absolutely-positioned descendant when it
     is that descendant's **containing block** (i.e. it's `position: relative/
     absolute/fixed`). `overflow:auto` on a `static` ancestor does NOT clip an
     abspos whose containing block is above it.

3. **Confirm the fix and add a regression.** Re-run the probe; the metric should
   drop to the viewport. Then add/extend an assertion in
   `check-board-layout.mjs` (fixture) and/or `check-board-layout-real.mjs`
   (real). Prefer the real check for anything the fixture can't model.

## Reproducing a DIFFERENT component

Copy the `board-probe` pattern: a `.html` entry that loads a `.ts` which imports
the real component, seeds its store(s) directly, and `mount()`s it into a shell
matching the real layout. Serve with `vite dev` and measure with `browser.mjs`. The
shell must give the component the same flex/height ancestry it has in production
(a stray wrapper div will change flex-1 sizing).

## Mobile viewport note

With `mobile: true`, an overflowed document expands the **layout viewport**
(`innerWidth` grows past the device width) and `position: fixed; inset-x-0`
elements resolve against the oversized viewport — the classic "fixed bar is too
wide / off-screen on mobile" symptom. Always assert `innerWidth <= device width`
and `documentElement.scrollWidth <= device width`, not just visible element rects.

## Chromium is not the target

Pass the engine to run the same probe under WebKit:

```js
const b = await createBrowser({ engine: 'webkit' });
```

Do it for anything touching focus, the on-screen keyboard, or what an unmount
does to a focused field: the two engines disagree there, Chromium is the
optimistic one, and a green Chromium run on its own is not an answer. CLAUDE.md's
"Checking what jsdom cannot model" has the specific difference and what it cost.

## Guardrails

- Test the real component before trusting a fixture. If a repro doesn't
  reproduce, suspect the repro first — don't invent a "simulation" to paper over
  the gap.
- Give every negative assertion a control. "Nothing was focused" reads the same
  whether the check works or never armed.
- Use `setViewport({ mobile: true })` for mobile behavior; plain width/height
  (mobile:false) gives a desktop-style viewport that won't expand on overflow.
- Don't capture screenshots expecting to view them in this harness — read numeric
  metrics (`scrollWidth`, `getBoundingClientRect`, `offsetParent`) instead.
