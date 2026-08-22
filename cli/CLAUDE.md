# critical-path — `cli/`

`cpath`, the command-line client for this repository's API (`critical-path-cli`).
`README.md` beside this file is the command reference; this one is for changing
the package.

This is one of four packages (`api/`, `web/`, `cli/`, `preview-edge/`). The root
`CLAUDE.md` carries what is true across all of them, `api/CLAUDE.md` is the
backend's manual, and this package is a consumer of that backend's contract and
of nothing else.

**Where commands run.** A bare `pnpm run …` here means from `cli/`, or
`pnpm -C cli run …` from the repository root. The test suite is the exception
and is an api-package command; see below.

# A sibling package, not a subdirectory

`cli/` was nested at `api/cli/` until the monorepo merge, and most of what used
to work by directory ancestry now has to be written down. It carries its own
`eslint.config.js`, `.prettierrc.json`, `.gitignore` and a self-contained
`tsconfig.json`, because a config search that walks up out of here reaches the
repository root, where there is deliberately nothing to find.

`tsconfig.json` has one thing api's does not: a `paths` entry mapping `vitest`
and `@hono/node-server` into `../api/node_modules`. The tests are executed by
api's vitest and resolve those from api's tree at run time, so tsc has to be
told where they are rather than finding them by walking up. Keep the rest of the
options in step with `api/tsconfig.json` — the tests import api's source
directly.

The separate `pnpm-lock.yaml` and `node_modules` are the point rather than an
accident: they are what keeps `api-deploy.yaml`'s path filter exact, so a CLI
dependency bump cannot redeploy the production API. **Never add a CLI dependency
to `api/package.json`.** `pnpm-workspace.yaml` here is a settings file with no
`packages:` key, holding this tree's own `allowBuilds` and two `overrides` that
must not migrate anywhere else.

# Running it

```sh
pnpm -C cli install --frozen-lockfile
pnpm add --global ./cli     # the global `cpath`
```

`bin/cpath.mjs` registers `tsx/esm/api` and imports `src/main.ts`, so the CLI
runs TypeScript directly and there is no build step to keep current — `dist/` is
gitignored and nothing writes it. Point a working copy at a local API with
`cpath config set api-url http://localhost:3001`; it defaults to production, and
`README.md` has the rest of that.

# Checks and tests

```sh
pnpm -C cli run check     # type-check, lint, format:check
pnpm -C api test          # the CLI's tests, and api's, in one suite
```

**The tests are collected by api's vitest, not by one of this package's own.**
`api/vitest.config.ts` includes `../cli/tests/**/*.test.ts`, and
`tests/e2e/helpers.ts` drives the Hono app in-process by importing
`../../../api/src/index`, so a CLI end-to-end test needs api's `.env.test` and a
migrated database like any api test does. That climbing glob is load-bearing and
silent when wrong: vitest exits 0 on an include that matches nothing, so after
touching it assert the collected file count rather than the exit status. A
single file runs as `pnpm test ../cli/tests/e2e/task.test.ts` **from `api/`** —
and with no `--` before the path, which pnpm forwards into argv where vitest
reads it as end-of-options and runs everything.

Knip is the other check that reaches across the boundary, and it also runs from
`api/`: `../cli` is a workspace in `api/knip.json`, which is what resolves this
package's imports against `cli/package.json` rather than api's. It has nothing
to do with pnpm workspaces, which this repository still must not have.

CI runs both, and it runs them under **API CI**. No workflow is scoped to this
package on its own: `api-ci.yaml` filters on `cli/**` as well as `api/**`, and
its `changes` job emits a `cli_code` output that the `checks` and shard jobs gate
on alongside `api_code`. A cli-only pull request therefore opens API CI, skips
the image builds, and runs everything else.

# The generated client

`src/api/api.generated.ts` and `src/api/realtime.generated.ts` are committed and
must never be hand-edited. One command rewrites them along with web's pair:

```sh
scripts/generate-clients.sh     # from the repository root, or anywhere
```

Commit the result with the api change that caused it — `codegen-ci.yaml` re-runs
the script and fails a pull request whose committed clients differ. That
workflow watches `cli/src/api/**` and `cli/scripts/**`, so a hand-edit fails
there by design. The package scripts behind it, `pnpm run generate:api` and
`pnpm run generate:realtime`, still work on their own; `scripts/generate-api-types.mjs`
here is a wrapper supplying `openapi-typescript` and an output path, and the
generator itself is shared with web under `scripts/lib/`.

# Where the API contract leaks past the generated client

openapi-typescript emits types and never values, which is what lets a
regenerated client ship before the api deploy that serves it — and it is also
why every *number* the server enforces reaches this package as a literal someone
typed by hand. Two mechanisms keep those honest, and they are not
interchangeable:

- `api/tests/unit/clientLimits.test.ts` reads `src/trello/import.ts` and
  `src/commands/task.ts` out of the tree and asserts their ceilings against the
  api constants they mirror. It fails here when a bound moves in `api/`, which is
  the direction that would otherwise be silent: raised there, this package goes
  on refusing input the server would accept, and nothing reports it.
- `src/watch.ts` annotates the socket heartbeat with the literal type the
  realtime document publishes, so a changed interval is a compile error instead
  of a test. Prefer that shape wherever a number can be published through the
  generated client at all; the test above is for the ones that cannot.

The `/ws` protocol is the other half of the contract and has no OpenAPI request
or response to describe it — `api/CLAUDE.md`'s realtime conventions are where it
is specified, and `src/watch.ts` is written against them.

# Style

Prettier's settings are in `.prettierrc.json`, and `format:check` covers `src/`,
`tests/`, `bin/` and `scripts/`. Never run `prettier --write` or `eslint --fix`
by hand: the root `.githooks/post-commit` hands each commit's paths to this
package's own pair and amends the result in.
