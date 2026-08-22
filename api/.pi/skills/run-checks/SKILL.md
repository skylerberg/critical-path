---
name: run-checks
description: Run the pre-finish check suite for the Critical Path api package, and the cli package it type-checks and tests. Use before declaring work done or opening a PR — type-check, lint, format:check, knip, the test suite, and the CLI sub-package checks. Includes the local-data safety rule.
---

# Run checks (api package)

Run these from `api/` before declaring done.

## Commands

```sh
pnpm run type-check        # tsc over src/, tests/, scripts/, vitest.config.ts and ../cli/
pnpm run lint              # eslint src tests bench
pnpm run format:check      # prettier --check
pnpm run knip              # unreferenced files, exports and dependencies
pnpm test                  # vitest: this package's suite plus ../cli/tests/**
pnpm -C ../cli run check   # CLI: type-check + lint + format:check
```

Every one of them only reads. The fixers are `pnpm run format` and
`pnpm run lint:fix`, and `.githooks/post-commit` is what runs them, so
`format:check` failing on an edit you have not committed yet reports the absence
of a commit rather than a problem with the code — `CLAUDE.md` in this package
carries the rule and its consequences.

`preview-edge/` is the one package none of the above reaches: it is outside
`api/tsconfig.json`'s include and outside `api/knip.json`, and no test here
imports it. `pnpm -C ../preview-edge run type-check` and
`pnpm -C ../preview-edge run test` are its whole check set, worth running when
you have touched it.

## What CI makes of this

`api-ci.yaml` runs the six commands above on every pull request — the first four
in its `checks` job, `pnpm test` sharded four ways across isolated
Postgres+Redis pairs, and preview-edge in a job of its own. It also refines
within its own filter: a pull request touching only `api/k8s/` or `api/docs/`
reports green having run none of them, so read which jobs were skipped before
treating a green run as evidence.

It is not the required check. The root `CLAUDE.md`'s "Git hooks and workflows"
section is the single description of what the repository runs and of why
`ci-gate.yaml` is the name branch protection holds.

## Test suite safety

`pnpm test` loads `.env.test` and runs against a database derived from this
checkout's path (`game_dev_test_api_<hash>`), which the global setup creates,
migrates and **truncates** at suite start. That derivation is what makes it safe
for several worktrees to run the suite at once, so never set `DB_DATABASE` to
pin a specific database — the run will refuse it.

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

`cli/CLAUDE.md` is that package's own manual, and covers what to assert after
touching that include.
