---
name: run-checks
description: Run the full pre-finish check suite for the Critical Path API repo. Use before declaring work done or opening a PR — type-check, lint, format, the test suite, and the CLI sub-package checks. Includes the local-data safety rule.
---

# Run checks (critical-path-api)

Run all of these before declaring done. CI runs the same set (`.github/workflows/ci.yaml`).

## Commands

```sh
npm run type-check       # tsc --noEmit
npm run lint             # eslint src tests
npm run format:check     # prettier --check
npm test                 # vitest against game_dev_test (loads .env.test)
npm run --prefix cli check   # CLI: type-check + lint + format:check
```

Run `npm run lint:fix` / `npm run format` to autofix, then re-check. The repo
also has a `post-commit` hook that auto-fixes lint/format on committed files
and amends — let it.

## Test suite safety

`npm test` loads `.env.test` and runs against `game_dev_test`. The global setup
migrates and **truncates** that database at suite start. The guard refuses to
run unless `ENVIRONMENT=test`, but never point it at `game_dev` — that database
holds the owner's real projects and tasks and must never be wiped, truncated, or
bulk-deleted. Only `game_dev_test` / `game_dev_test_*` may be reset.

## If you changed the API surface

A changed request/response shape requires regenerating the web and CLI clients
— run the `change-api-schema` skill, then re-run `npm run --prefix cli check`.

## CLI worktree note

From a `.pi/worktrees/*` checkout, symlink `node_modules`
(`ln -s ../../../node_modules node_modules`, adjusting depth) and run CLI checks
from the worktree — the root `npm test` also drives the CLI e2e suites.
