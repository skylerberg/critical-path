---
name: run-checks
description: Run the full pre-finish check suite for the Critical Path web repo (Svelte 5 + Vite). Use before declaring work done or opening a PR — svelte-check, eslint, prettier, vitest (jsdom), and the production build.
---

# Run checks (critical-path-web)

Run all of these before declaring done. CI runs the same set
(`.github/workflows/ci.yaml`).

## Commands

```sh
npm run check           # svelte-check (type checking)
npm run check:layout    # real-Chrome board/bottom-nav layout assertions (fixture, no deps)
npm run check:layout:real # real-Chrome layout assertions against the actual Board.svelte (boots vite dev)
npm run lint            # eslint .
npm run format:check    # prettier --check src
npm test                # vitest (jsdom); tests are colocated as *.test.ts
npm run build           # production build incl. PWA assets
```

Run `npm run lint:fix` / `npm run format` to autofix, then re-check.

## Notes

- Tests are colocated: `src/**/*.test.ts`. Vitest mounts components because
  `svelteTesting()` is wired in `vite.config.ts` — do not remove it.
- `npm run check:layout` drives a real headless Chromium (via Playwright)
  against `scripts/board-layout.fixture.html` to assert mobile board layout that
  jsdom cannot measure (columns fill the board, no vertical overflow, the bottom
  nav stays on-screen and screen-wide). It skips with a warning if Chromium
  isn't installed locally; CI installs it. First-time local setup:
  `npm run playwright:install`. Run `node scripts/check-board-layout.mjs
  --selftest` to confirm the fixture is still sensitive to the original bug.
- `npm run check:layout:real` is the faithful companion: it mounts the **real**
  `Board.svelte` (via `scripts/board-probe.html`) in headless Chrome, so it
  catches layout bugs the fixture can't model (real Tailwind output, real
  svelte-dnd-action). It boots `vite dev` itself. For layout bugs generally,
  see the `browser-repro` skill.
- If `src/api/api.generated.ts` is stale (a backend schema changed), run
  `npm run generate:api` first — it auto-finds `../critical-path-api/openapi.json`.
  A stale client only fails under `npm run check`, never under `npm test`, so
  don't trust a green test suite alone when the API changed.
- From a `.pi/worktrees/*` checkout, symlink `node_modules`
  (`ln -s ../../../node_modules node_modules`, adjusting depth) rather than
  reinstalling.
- `vite.config.ts` (vitest `exclude`) and `eslint.config.js` (`ignores` + a
  pinned `tsconfigRootDir`) keep linked worktrees under `.pi/worktrees/**` and
  `.claude/**` out of scans launched from the main checkout — otherwise their
  own `tsconfig.json`/test files pollute `eslint .` (multiple
  `tsconfigRootDir` candidates) and `npm test` (runs sibling worktrees' tests).
  Don't remove those entries.
