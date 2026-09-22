# Critical Path

One repository, four packages, **no root package and no root `node_modules`**.

| Package         | What it is                                   | Its docs                         |
| --------------- | -------------------------------------------- | -------------------------------- |
| `api/`          | Hono + Kysely + Postgres backend             | `api/AGENTS.md`, `api/README.md` |
| `web/`          | Svelte 5 (runes) + Vite SPA/PWA frontend     | `web/AGENTS.md`, `web/README.md` |
| `cli/`          | `cpath`, a command-line client for the API   | `cli/AGENTS.md`, `cli/README.md` |
| `preview-edge/` | the Cloud Run worker that serves PR previews | `preview-edge/README.md`         |

Each package's own docs are its operating manual; this file holds what is true
across all of them. Read it before your first change.

`infra/terraform/` is not a fifth package. It is the terraform for the whole
repository — the load balancer and URL map, the web bucket and CDN, the
preview-edge Cloud Run service, certificates, Artifact Registry, monitoring,
and four api-only resources. `infra-ci.yaml` is its CI;
`infra/terraform/README.md` is its operating manual. `docs/` holds prose about
the product rather than about one package; `scripts/` holds shared tooling and
has its own README.

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

Each package's `pnpm-workspace.yaml` is a settings file, not a workspace
declaration — none has a `packages:` key. pnpm 11 reads settings from nowhere
else (not `.npmrc` beyond auth and registry, not package.json's `pnpm` field),
and **keys are camelCase**: a kebab-case key is dropped silently. `allowBuilds`
gates whether a dependency may run install scripts, with `strictDepBuilds`
failing the install on any unlisted one — adding a dependency that builds means
listing it there in the same commit. `minimumReleaseAge` refuses versions
younger than the gate outright, so a brand-new release of a dependency fails
resolution rather than falling back.

## Toolchain and command names

**The shared toolchain is pinned to an exact version in every `package.json`:**
`typescript`, `typescript-eslint`, `eslint`, `@eslint/js`, `prettier` and
`@types/node` carry bare versions, no `^` and no `~`. Each decides whether a
check is green, and a range makes the answer depend on when a lockfile was last
written. It binds harder here because `api/tsconfig.json` includes
`../cli/**/*`: the CLI's sources are type-checked twice, under each package's
`@types/node`, and only a pin makes those two runs the same run.
`openapi-typescript` is pinned because it writes four committed files that
`codegen-ci.yaml` re-derives and diffs. Libraries are not pinned.

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

## Staying current with main

`main` moves fast, so a branch cut an hour ago is routinely behind, and nothing
tells you until a rebase conflicts or CI fails on a rule your base predates.
Rebase onto `main` (not merge: branches are rebased, only the PR itself lands
as a merge commit) and check at three points: **before starting** (also run
`gh pr list` — the fix may already be open), **before running a full suite**,
and **before pushing** (`gh pr view <n> --json mergeStateStatus` reports
`CLEAN` only for a branch that still applies).

**Scope the staleness check to your side of the tree.** The bare
`git rev-list --count HEAD..origin/main` counts every package's traffic, so it
is almost never 0 and says nothing about your base. Ask:

```sh
git fetch origin && git rev-list --count HEAD..origin/main -- api/   # or -- web/, -- cli/
```

Drop the pathspec deliberately when the change spans packages, and read the
answer as two numbers. Being behind on a package you are not touching is a
reason to rebase before you push, not mid-change.

After any rebase, re-run the checks rather than trusting the pre-rebase pass,
and re-run whatever generation the change involves **after** the rebase, not
before — a rebase can bring in a schema change that silently invalidates a
committed generated file, and regenerating early produces a misleading diff on
a dirty tree that `git rebase` then refuses.

Two traps that produce *wrong* conclusions rather than failures:

- **Comments about build configuration go stale.** Read `package.json` and
  `tsconfig.json` rather than a comment describing them.
- **"No diff" is not a passing check.** `git diff --quiet <file>` is vacuously
  clean for a gitignored file, and for one a failed command never wrote —
  `openapi.json` and `realtime-events.json` are both gitignored. Assert the
  positive: the command exited 0, the file was written, the content is what you
  expected.

One conflict resolves wrongly by default: a branch cut before those two dumps
were untracked still carries the tracked copy, so merging main raises a
modify/delete conflict on it. Keep the deletion — the file is a dump now.

## The root `scripts/` directory

`scripts/README.md` is the index. Two rules hold the directory together:

**It is not a package and must never become one.** No `package.json`, no
`node_modules`, no lockfile — so **a file under `scripts/` may import node
builtins and its own siblings, nothing else.** Bare specifiers resolve upward
from the importing file, and the root has no `node_modules` to find. Nothing
formats or lints the `.mjs` here: match the shared prettier style by hand (100
columns, single quotes, semicolons, two-space indent). `repo-ci.yaml` does
shellcheck the `.sh`, and the comment check reads the `.mjs` for prose.

**`node scripts/check-comments.mjs` is the prose gate for the whole tree.** It
reports one sentence living in two files, and a file or symbol that prose names
but that does not resolve. Run it after moving a rule between documents (and
`--selftest` after changing what it asserts). `scripts/comment-allowlist.txt`
is the narrow escape hatch, and a stale entry there is itself reported.

## Git hooks and workflows

`.githooks/` at the root is the only hook directory git uses (`core.hooksPath`,
written by `scripts/setup-hooks.mjs`, which all four packages' `prepare`
runs). `post-commit` and `post-rewrite` hand the paths a commit touched to
`format-touched`, which buckets each by its first segment and runs **that
package's own** eslint and prettier; a package with no config or no installed
binary is named in a warning and skipped. **Never run `prettier --write` or
`eslint --fix` by hand — run `scripts/format-changed.sh` instead,** which puts
the working tree's modified and untracked files through the same dispatcher
without amending anything. That closes the loop the amend used to force:
format first, and `format:check` passes on a working tree, before the commit,
instead of only after the hook has rewritten it.

The hook has tests — `sh .githooks/tests/format-touched.test.sh`, run by
`repo-ci.yaml` and by nothing else. Add a case for anything you change in a
hook. One known limitation: a path containing a space reaches the fixers split
in two and is left unformatted.

Every workflow under `.github/workflows/` is filtered to the packages it
checks. No pnpm command in CI runs at the root, and every `setup-node` that
caches names an explicit `cache-dependency-path`, because there is no root
lockfile. `repo-ci.yaml` carries no `paths:` at all: its `repo-files` job
covers `.githooks/**`, `scripts/**` and `.github/workflows/**`, and its
`comments` job reads every package's prose at once. `k8s-ci.yaml` validates
`api/k8s/**`; `infra-ci.yaml` validates the terraform (fmt/init/validate — it
cannot plan, so it catches a broken configuration and not a wrong one).

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
workflow whose lack of a `paths:` filter is what makes it requireable; it reads
the other runs' results for the head commit and fails if any of them did not
pass. **`ci-gate` is the check to
require in branch protection** — a manual step in the GitHub UI; the file's
header explains the mechanism and why a skipped job is a *green* required
check.

`.github/` also holds `CODEOWNERS`, which claims the paths that reach
production and that no check reads for *intent* (`infra/`, `api/k8s/`,
`.github/`, `.githooks/`) plus this file, and `pull_request_template.md`, whose
job is to put the two-commit deploy rule in front of a human.
