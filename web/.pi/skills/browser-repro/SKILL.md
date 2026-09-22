---
name: browser-repro
description: Reproduce and debug layout, focus and other bugs against the REAL component in a headless browser (measures what jsdom cannot — box model, focus, showModal, computed styles). Use for any layout issue — elements overflowing or off-screen, fixed/sticky nav misbehavior, unexplained gaps, mobile viewport/scroll problems — and for anything about focus or the on-screen keyboard, which wants WebKit as well as Chromium. Prevents the failure mode of diagnosing against an unfaithful hand-authored fixture.
---

# Browser repro for layout bugs

jsdom (the vitest environment) has **no box model** — it cannot catch layout
bugs, and a hand-authored fixture can pass while the real app fails. For any
layout/visual bug, reproduce against the **real component** in a real browser
before diagnosing.

Everything here rides on Playwright (already a dev dependency): it drives a
pinned headless Chromium via `scripts/lib/browser.mjs`. First-time local setup:
`pnpm run playwright:install` (downloads Chromium once).

## The tools (already in the repo)

- `scripts/lib/browser.mjs` — reusable helper: `createBrowser()`
  → `{ setViewport, goto, eval, press, click, screenshot, close }`. **Use this
  instead of writing Playwright boilerplate.** Its header documents the
  signatures and the null-on-missing-engine skip.
- `scripts/board-probe.html` + `scripts/board-probe.ts` — mounts the **real**
  `Board.svelte` with seeded data inside an App/Project shell. Parametrized:
  `?cols=N&tasks=M&readonly=1`.
- `scripts/task-detail-probe.ts` + `scripts/check-task-detail.mjs` — the same
  shape around one component rather than a whole route, and the closer model to
  copy for a new probe. It asks what jsdom cannot answer about focus.
- `scripts/check-board-layout.mjs` — fast gate against a faithful *fixture*
  (CI: `check:layout`).
- `scripts/check-board-layout-real.mjs` — gate against the **real component**
  via the probe (CI: `check:layout:real`).

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

   (Run `pnpm run dev` on any free port first, e.g. `vite --port 5180 --strictPort`,
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

Copy the probe shape: a dev-only `.html` vite entry, a `.ts` beside it that
imports the real component, seeds its store(s) directly, and `mount()`s it into
a shell matching the real layout, plus a `.mjs` driver that boots vite
in-process and evaluates against it. The shell must give the component the same
flex/height ancestry it has in production (a stray wrapper div will change
flex-1 sizing).

Traps a probe of that shape hits:

- **`import './board-probe-net'` first is load-bearing.** The api client
  captures `globalThis.fetch` when `createClient()` runs at module init
  (`src/api/client.ts`), so whoever installs a stub after that point is talking
  to nobody. Imports are evaluated before any statement in the probe entry's
  body, so a stub written in the body is on the wrong side of that line. A probe
  that needs its own answer for a route wants a second module, imported after
  `board-probe-net`.
- **`board-probe-net` answers by echoing the request body, so a GET is answered
  `{}`** — not the shape the OpenAPI types promise. Every store assigns
  straight off the payload, so a probe of a component that GETs a list crashes
  on `undefined.map`. Answer that route yourself; do not add a guard to the
  store, whose contract is fine. The probe boundary is asserted: mounting and
  scrolling must issue no requests at all, and a drop must issue exactly one
  PATCH.
- **An open `<dialog>` makes the rest of the page inert.** A probe that opens a
  modal and then tests focus elsewhere reports "nothing focused" under both
  engines. `dialog.close()` first.
- **Give every negative assertion a control.** "`focus({ preventScroll: true })`
  left `scrollY` at 0" means nothing until a plain `focus()` on the same page
  is shown to move it. WebKit does not scroll on focus in cases where Chromium
  does, so on WebKit that control is what tells you the check is inert rather
  than passing.

A probe has to sit inside the repo to resolve `vite`, `playwright` and the
helper itself. **Name it `scripts/tmp-<what>.mjs`** — that prefix is ignored by
git, by eslint, by vitest's test discovery and by `scripts/check-comments.mjs`,
which is every gate that walks the tree. Delete it when you are done anyway.

**Being ignored costs the probe its Tailwind classes.** Tailwind v4 compiles
the classes it finds in whatever `.gitignore` does not exclude, so a class
named only inside a `scripts/tmp-*` file gets no rule and markup the probe
injects renders unstyled. Style injected markup inline, or check the compiled
sheet before trusting a measurement of it:

```js
const css = await (await fetch(new URL('src/app.css?direct', base))).text();
css.includes(String.raw`.w-\[134px\]`); // false ⇒ nothing is styling that element
```

## Browser behaviours that have bitten

- **Mobile viewport.** With `mobile: true`, an overflowed document expands the
  **layout viewport** (`innerWidth` grows past the device width) and
  `position: fixed; inset-x-0` elements resolve against the oversized viewport
  — the classic "fixed bar is too wide / off-screen on mobile" symptom. Always
  assert `innerWidth <= device width` and
  `documentElement.scrollWidth <= device width`, not just visible element
  rects. `mobile` defaults to true; a desktop case has to say
  `mobile: false`.
- **`colorScheme`** (`'light'` by default) drives `prefers-color-scheme`, the
  only way to reach the dark half of the palette. Playwright fixes viewport and
  scheme per context, so flipping either discards the page: `goto` again after
  every `setViewport`.
- **Colour transitions.** Most controls here carry `transition-colors`, which
  transitions `outline-color` too, so reading a focus ring in the same tick as
  `focus()` samples it mid-fade. Let it settle before believing the value.
- **Chromium is not the target.** `createBrowser({ engine: 'webkit' })` runs
  the same probe under WebKit, which every iOS browser uses. The two disagree,
  and Chromium is the optimistic one — removing a focused input fires `blur` in
  Chromium and **not** in WebKit. Any question about focus, the on-screen
  keyboard, or what an unmount does to a focused field wants both engines; one
  green Chromium run is not an answer. Only the committed checks are
  Chromium-only, so CI installs Chromium alone and a committed check asking for
  WebKit would fail loudly there. `engine: 'firefox'` exists and is the one
  engine `pnpm run playwright:install` leaves out; install it when a report
  names it.

## Guardrails

- Test the real component before trusting a fixture. If a repro doesn't
  reproduce, suspect the repro first — don't invent a "simulation" to paper over
  the gap.
- Don't capture screenshots expecting to view them in this harness — read numeric
  metrics (`scrollWidth`, `getBoundingClientRect`, `offsetParent`) instead.
