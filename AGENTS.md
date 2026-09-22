# Critical Path

One repository, four packages, **no root package and no root `node_modules`**.

| Package         | What it is                                   | Its docs                        |
| --------------- | -------------------------------------------- | ------------------------------- |
| `api/`          | Hono + Kysely + Postgres backend             | `api/AGENTS.md`, `api/README.md` |
| `web/`          | Svelte 5 (runes) + Vite SPA/PWA frontend     | `web/AGENTS.md`, `web/README.md` |
| `cli/`          | `cpath`, a command-line client for the API   | `cli/AGENTS.md`, `cli/README.md` |
| `preview-edge/` | the Cloud Run worker that serves PR previews | `preview-edge/README.md`        |

Each package's own docs are its operating manual; this file holds only what is
true at the root.

`infra/terraform/` is not a fifth package. It is the terraform for the whole
repository — the global load balancer and its URL map, the web bucket and CDN,
the preview-edge Cloud Run service, the certificates, the Artifact Registry
repository, the monitoring, and four api-only resources (its service account,
workload-identity binding, uploads bucket and that bucket's IAM member).
`infra-ci.yaml` is its CI; `infra/terraform/README.md` is its operating manual.

## This is not a pnpm workspace, and must never become one

Four `package.json`, four `pnpm-lock.yaml`, four `pnpm-workspace.yaml` — one set
per package, **none at the root**. Install each where it lives:

```sh
pnpm -C api install
pnpm -C web install
pnpm -C cli install
pnpm -C preview-edge install
```

**Never create `pnpm-workspace.yaml` at the repository root.** pnpm searches
upward for it, so a package that lost its own would resolve to the root file
instead — and a root file with no `packages:` key matches nothing, so
`pnpm install` prints `No projects found`, **exits 0** and writes no
`node_modules` at all. Every later failure then arrives as an unexplained
cannot-find-module in a package whose install reported success. The four
lockfiles also keep each deploy workflow's path filter exact: a shared one
would make a CLI dependency bump redeploy the production API.

## Toolchain and command names

**The shared toolchain is pinned to an exact version in every `package.json`:**
`typescript`, `typescript-eslint`, `eslint`, `@eslint/js`, `prettier` and
`@types/node` carry bare versions, no `^` and no `~`. Each decides whether a
check is green, and a range makes the answer depend on when a lockfile was last
written. It binds harder here because `api/tsconfig.json` includes
`../cli/**/*`: the CLI's sources are type-checked twice, under each package's
`@types/node`, and only a pin makes those two runs the same run.
`openapi-typescript` is pinned for a different reason: it writes four committed
files that `codegen-ci.yaml` re-derives and diffs, so two packages floating
apart on it surfaces as an unreadable drift failure. Libraries are not pinned.

**A command name means one thing in every package.** `type-check`, `lint`,
`lint:fix`, `format`, `format:check` and `check:all` exist in all four; web's
`type-check` runs `svelte-check` where the others run `tsc`. There is no bare
`check` anywhere.

**Beware `pnpm run x -- <arg>`: pnpm forwards the `--` into argv** where npm
swallowed it, and vitest reads it as end-of-options — `pnpm test -- <path>`
silently runs the whole suite and passes. Write `pnpm test <path>`.

## The two-commit deploy rule

**An API endpoint and the web code that calls it must reach `main` in two
separate merges, api first.**

Both production deploys fire from one push — `api-deploy.yaml` on `api/src/**`
and friends, `web-deploy.yaml` on `web/**` — and web's finishes well before
api's. For that window the deployed SPA calls endpoints the deployed API does
not serve yet, with nothing red in CI. Nothing enforces the ordering, so it is
a rule.

Two commits inside one pull request do **not** satisfy it: a push's `paths`
filter is evaluated over the push's whole commit range, so one merge carrying
both starts both deploys at the same moment — which is the race itself.
Removals run the other way: web stops calling the endpoint in the earlier
merge, api deletes it in the later one.

The **generated** clients are exempt. `codegen-ci.yaml` fails any pull request
whose committed `*.generated.ts` files are not what
`scripts/generate-clients.sh` produces, so they land in the same merge as the
api change — safe because they declare types and no runtime values, so the web
deploy they trigger ships a byte-identical bundle. It is the call sites that
wait for the second merge.

This is the client half of the rolling-deploy discipline in `api/AGENTS.md`'s
migration workflow: old and new have to interoperate across a window whose
length you do not control.

## One `main` serves both projects

`git rev-list --count HEAD..origin/main` counts the other package's traffic
too, so it is almost never 0. Ask about your own side:

```sh
git fetch origin && git rev-list --count HEAD..origin/main -- api/   # or -- web/
```

`api/AGENTS.md`'s "Staying current with main" is the full version;
`web/AGENTS.md`'s section of that name is the frontend's half.

## The root `scripts/` directory

`scripts/README.md` is the directory's index. The short version:

- `scripts/generate-clients.sh` regenerates all four committed API clients; run
  it after any schema or realtime-payload change and commit its output with the
  change.
- `scripts/new-worktree.sh <branch>` is the worktree bootstrap for all four
  packages. Make every worktree with it — a hand-made one fails the checks for
  reasons unrelated to the change in it. It sits at the root, not in
  `api/scripts/`, because `api-deploy.yaml` filters on `api/scripts/**`.
- `scripts/check-comments.mjs` is the prose gate: it reports one sentence
  living in two files, and a file or symbol that prose names but that does not
  resolve. `scripts/comment-allowlist.txt` is the narrow escape hatch, and a
  stale entry there is itself reported.
- `scripts/lib/` holds the OpenAPI client generator both client packages run;
  each package owns only a wrapper supplying `openapi-typescript` and an output
  path.

**It is not a package and must never become one.** No `package.json`, no
`node_modules`, no lockfile — so **a file under `scripts/` may import node
builtins and its own siblings, nothing else.** Bare specifiers resolve upward
from the importing file, and the root has no `node_modules` to find. Nothing
formats or lints this directory: match the shared prettier style by hand (100
columns, single quotes, semicolons, two-space indent). `repo-ci.yaml` does
shellcheck the `.sh` here, and the comment check reads the `.mjs` for prose.

## The root `docs/` directory

Prose about the product rather than about one package.
`docs/feature-research.md` is the survey of the category with the owner's
build/decline decision on every feature — the roadmap the whole repository
works from.

The test for what belongs here is who the reader is, not where the subject is
implemented: `api/docs/scaling.md` stays in `api/` because it is keyed to
`api/bench/` and means nothing to `web/`.

A commit touching only this directory matches no package's `paths:` filter, but
it is not unchecked: `repo-ci.yaml` carries no filter, and its comment job
holds this prose to the files and symbols it names.

## Git hooks and workflows

`.githooks/` at the root is the only hook directory git uses (`core.hooksPath`,
written by `scripts/setup-hooks.mjs`, which all four packages' `prepare`
runs). `post-commit` and `post-rewrite` hand the paths a commit touched to
`format-touched`, which buckets each by its first segment and runs **that
package's own** eslint and prettier; a package with no config or no installed
binary is named in a warning and skipped. **Never run `prettier --write` or
`eslint --fix` by hand.**

That script has tests — `.githooks/tests/format-touched.test.sh`, run by
`repo-ci.yaml` and by nothing else. They stub `git` and `pnpm` onto PATH, so
they need no repository, no `node_modules` and no network:

```sh
sh .githooks/tests/format-touched.test.sh
```

Add a case for anything you change in a hook. One known limitation: a path
containing a space reaches the fixers split in two, is reported, and is left
unformatted.

Every workflow under `.github/workflows/` is filtered to the packages it
checks. No pnpm command in CI runs at the root, and every `setup-node` that
caches names an explicit `cache-dependency-path`, because there is no root
lockfile. `repo-ci.yaml` carries no `paths:` at all: its `repo-files` job
covers `.githooks/**`, `scripts/**` and `.github/workflows/**`, and its
`comments` job reads every package's prose at once. `k8s-ci.yaml` validates
`api/k8s/**`, which sits inside api-ci's filter but is read by no job there.
`infra-ci.yaml` covers `infra/**`: `terraform fmt -check`, `init
-backend=false` and `validate` — it cannot plan, so it catches a broken
configuration and not a wrong one.

Every workflow that checks something must also be named in `ci-gate.yaml`'s
`is_blocking` (or `is_advisory`). An unlisted name fails the gate by design, so
adding or renaming a workflow is two edits, not one — and `repo-ci.yaml` checks
the pair statically, so a missed second edit fails on the pull request that
made it.

Filtering happens in two layers, and they are not interchangeable. A
workflow's `paths:` is the outer bound — narrowing it drops coverage leaving
no run behind to notice. Refining happens **inside**: `api-ci.yaml`,
`web-ci.yaml` and `repo-ci.yaml` each have a `changes` job that diffs the
event's own range and gates expensive jobs on an `if:`. All three fail open,
loudly, when the event's base ref cannot be resolved: running too much is
always correct, skipping silently never is.

## What makes CI enforceable

`ci-gate.yaml` exists because path filtering and required status checks are in
direct conflict: a workflow its filter excludes produces no check run, and
GitHub waits on a required-but-absent check forever. The gate is the one
workflow with no `paths:`; it reads the other runs' results for the head
commit and fails if any of them did not pass. **`ci-gate` is the check to
require in branch protection** — a manual step in the GitHub UI; the file's
header explains the mechanism and why a skipped job is a *green* required
check.

`.github/` also holds `CODEOWNERS`, which claims the paths that reach
production and that no check reads for *intent* (`infra/`, `api/k8s/`,
`.github/`, `.githooks/`) plus this file, and `pull_request_template.md`, whose
job is to put the two-commit deploy rule in front of a human.
