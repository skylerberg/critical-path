---
name: run-checks
description: Run the full pre-finish check suite for the Critical Path API repo. Use before declaring work done or opening a PR — type-check, lint, format, the test suite, and the CLI sub-package checks. Includes the local-data safety rule.
---

# Run checks (api package)

Run all of these before declaring done. CI runs the same set, in
`.github/workflows/api-ci.yaml`'s `checks` job — which a `changes` job skips
when a pull request touches only `api/k8s/` or `api/docs/`.

## Commands

```sh
pnpm run type-check       # tsc over src/, tests/, scripts/, vitest.config.ts
pnpm run lint             # eslint src tests
pnpm run format:check     # prettier --check
pnpm test                 # vitest against game_dev_test (loads .env.test)
pnpm -C ../cli run check   # CLI: type-check + lint + format:check
```

Run `pnpm run lint:fix` / `pnpm run format` to autofix, then re-check. The repo
also has a `post-commit` hook that auto-fixes lint/format on committed files
and amends — let it.

## Test suite safety

`pnpm test` loads `.env.test` and runs against a database derived from this
checkout's path (`game_dev_test_<checkout>_<hash>`), which the global setup
creates, migrates and **truncates** at suite start. That derivation is what
makes it safe for several worktrees to run the suite at once, so never set
`DB_DATABASE` to pin a specific database — the run will refuse it.

The guard also refuses to run unless `ENVIRONMENT=test`, but never point any of
this at `game_dev` — that database holds the owner's real projects and tasks and
must never be wiped, truncated, or bulk-deleted. Only `game_dev_test` /
`game_dev_test_*` may be reset.

## If you changed the API surface

A changed request/response shape requires regenerating the web and CLI clients
— run the `change-api-schema` skill, then re-run `pnpm -C ../cli run check`.

## CLI worktree note

A worktree installs its own dependencies (`../scripts/new-worktree.sh` does
this, once per package — it is at the repository root, not in this package's
`scripts/`), so run the CLI checks from the worktree — the root
`pnpm test` also drives the CLI e2e suites: vitest.config.ts includes
`../cli/tests/**/*.test.ts`, reaching out of this package into the sibling.
