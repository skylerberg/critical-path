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
npm run lint            # eslint .
npm run format:check    # prettier --check src
npm test                # vitest (jsdom); tests are colocated as *.test.ts
npm run build           # production build incl. PWA assets
```

Run `npm run lint:fix` / `npm run format` to autofix, then re-check.

## Notes

- Tests are colocated: `src/**/*.test.ts`. Vitest mounts components because
  `svelteTesting()` is wired in `vite.config.ts` — do not remove it.
- If `src/api/api.generated.ts` is stale (a backend schema changed), run
  `npm run generate:api` first — it auto-finds `../critical-path-api/openapi.json`.
  A stale client only fails under `npm run check`, never under `npm test`, so
  don't trust a green test suite alone when the API changed.
- From a `.pi/worktrees/*` checkout, symlink `node_modules`
  (`ln -s ../../../node_modules node_modules`, adjusting depth) rather than
  reinstalling.
