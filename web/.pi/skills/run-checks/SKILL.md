---
name: run-checks
description: Run the checks for the Critical Path web repo (Svelte 5 + Vite). Use before opening a PR — which mostly means running the few checks that cover what you changed and letting CI run the rest.
---

# Run checks (critical-path-web)

`pnpm run check:all` is the whole gate, and CI runs exactly that
(`.github/workflows/ci.yaml` is one step). `package.json` is where the list
lives; nothing else should copy it.

## What to run by hand

Not `check:all`. It is minutes of typecheck, every browser check, the suite and
a production build, and CI runs it on every push anyway. Run what covers your
change:

```sh
pnpm test src/lib/board.test.ts    # a file or a directory; seconds
pnpm run check                       # svelte-check, after a type or API change
pnpm run check:layout:real           # after a board layout change
pnpm run check:task-detail           # after touching the card overlay
pnpm run check:a11y                  # after changing markup or a colour token
pnpm run check:comments              # after moving a rule between a comment and a doc
```

Then push and read the CI run.

## Notes

- **Do not run `prettier --write` or `eslint --fix` by hand.**
  `.githooks/post-commit` runs both over the files each commit touched and
  amends the result in. `format:check` failing on uncommitted edits means
  nothing has fixed them yet — commit, and it resolves.
- The browser checks need `pnpm run playwright:install` once locally. They skip
  with a warning if Chromium is missing; in CI a launch failure throws instead.
- Each of `check:layout`, `check:layout:real`, `check:task-detail`,
  `check:comments` and `check:a11y` takes `--selftest`, which re-runs its cases
  against something deliberately put back on the bug. Run it after changing what
  one asserts.
- Tests are colocated (`src/**/*.test.ts`) and mount components because
  `svelteTesting()` is wired in `vite.config.ts` — do not remove it.
- A stale `src/api/api.generated.ts` fails only under `pnpm run check`, never
  under `pnpm test`, so a green suite is not evidence after an API schema change.
  CLAUDE.md covers regenerating, including the cross-repo case.
- `vite.config.ts` and `eslint.config.js` keep linked worktrees out of scans
  launched from the main checkout. Don't remove those entries.
