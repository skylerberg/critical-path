# Critical Path

One repository, four packages, **no root package and no root `node_modules`**.

| Package         | What it is                                       | Its docs                              |
| --------------- | ------------------------------------------------ | ------------------------------------- |
| `api/`          | Hono + Kysely + Postgres backend                 | `api/CLAUDE.md`, `api/README.md`       |
| `web/`          | Svelte 5 (runes) + Vite SPA/PWA frontend         | `web/CLAUDE.md`, `web/README.md`       |
| `cli/`          | `cpath`, a command-line client for the API       | the CLI section of `api/CLAUDE.md`     |
| `preview-edge/` | the Cloud Run worker that serves PR previews     | `.github/workflows/preview-edge.yaml`  |

The two package CLAUDE.md files are the operating manuals; this one holds only
what is true at the root.

`infra/terraform/` is not a fifth package and has no `package.json`. It is the
terraform for the whole repository — the global load balancer and its URL map,
the web bucket and its CDN backend, the preview-edge Cloud Run service, the
certificates, the Artifact Registry repository both images are pushed to, and
the monitoring. Four resources in it are the api's alone — its service account,
that account's workload-identity binding, the uploads bucket and the bucket's
IAM member. The rest are shared, which is why it sits at the root rather than
under `api/`, where it lived until 2026-08-21.
`.github/workflows/infra-ci.yaml` is its CI, and `infra/terraform/README.md` is
the operating manual for applying it.

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
upward for it, so the moment one exists, any package that lacks its own resolves
to the root file instead. A root file with no `packages:` key matches no
project, so `pnpm install` prints `No projects found`, **exits 0**, and writes no
`node_modules` at all — and every later failure arrives as an unexplained
cannot-find-module in a package whose install reported success. The four
lockfiles are also what keep each deploy workflow's path filter exact: a shared
one would make a CLI dependency bump redeploy the production API.

## The two-commit deploy rule

**An API endpoint and the web code that calls it must reach `main` in two
separate merges, api first.**

Both production deploys fire from one push — `api-deploy.yaml` on `api/src/**`
and friends, `web-deploy.yaml` on `web/**`. Measured, web ships in about 45
seconds and api in 2m21s–3m23s, so a bundle calling a new endpoint goes live
roughly two minutes **before** the pods that serve it, and for that window the
deployed SPA 404s against the deployed API, for real users, with nothing red in
CI. While these were two repositories the ordering came for free: a human merged
two PRs at two different moments. Nothing enforces it now, so it is a rule.

Two commits inside one pull request do **not** satisfy it. A push's `paths`
filter is evaluated over the push's whole commit range, so one merge carrying
both starts both deploys at the same moment — which is the race itself. It has
to be two merges. Removals run the other way: web stops calling the endpoint in
the earlier merge, api deletes it in the later one.

The **generated** clients are not the thing that waits. `codegen-ci.yaml` fails
any pull request whose committed `*.generated.ts` files are not what
`scripts/generate-clients.sh` produces, so they land in the same merge as the api
change — which is safe precisely because they declare no runtime values, only
types, so the web deploy they trigger ships a byte-identical bundle. It is the
call sites that wait for the second merge. Do not "fix" that check by exempting
api pull requests; its header comment carries the reasoning.

This is the same constraint as the rolling-deploy discipline in `api/CLAUDE.md`'s
migration workflow: old and new have to interoperate across a window whose
length you do not control. That section covers the database half of it; this
covers the client half.

## One `main` now serves both projects

`git rev-list --count HEAD..origin/main` is almost never 0 here: it counts the
other project's traffic too — over 60 days api landed 189 first-parent commits
and web 245, and on one day it was api 6 and web 34. Ask about your own side:

```sh
git fetch origin && git rev-list --count HEAD..origin/main -- api/   # or -- web/
```

Both package files carry the longer version under "Staying current with main".

## The root `scripts/` directory

`scripts/generate-clients.sh` regenerates all four committed API clients — api's
two spec dumps, then web's two clients, then the CLI's two — and is the command
to run after any schema or realtime-payload change. It needs no `.env`, no
database and no server, it can be run from any directory, and it only sequences
the six package scripts. `scripts/README.md` is the directory's own index.

`scripts/new-worktree.sh <branch> [base-ref]` is the worktree bootstrap for all
four packages: it branches, adds the worktree under `~/.worktrees/<repo>/<branch>`
— outside the repository, so no recursive search gets a second copy of the
codebase to walk — copies the untracked `.env` files, which live in `api/` and
not at the checkout root, and runs `pnpm install` in every package it finds via
`git ls-files '*/package.json'`. It asserts a `node_modules` appeared rather than
trusting exit 0, which is what a stray root `pnpm-workspace.yaml` would otherwise
hand you. `--only api,web` narrows the installs. Everything is resolved from the
checkout it is **run in**, so it works from a sibling project too. Make every
worktree with it: a hand-made one fails the checks for reasons that have nothing
to do with the change in it, and an uninstalled `cli/` in particular fails only
the CLI tests, deep into an api run.

It sits here rather than in `api/scripts/`, where it was written, because
`api-deploy.yaml` filters on `api/scripts/**` — so a four-package developer
script was shipping a production API release, image build and migration job
included, on every edit.

`scripts/lib/` holds the OpenAPI client generator that `web/` and `cli/` both
run. It is one program: `pnpm -C web run generate:api` and
`pnpm -C cli run generate:api` are the same commands with the same behaviour,
and all each package still owns is a wrapper that supplies `openapi-typescript`
and the path to write. The two used to be forked copies, and the fork was not
theoretical — one pruned the schemas a deprecated operation orphaned and the
other did not, and one swallowed a failed dump and generated from whatever stale
file was lying around.

**It is not a package and must never become one.** No `package.json`, no
`node_modules`, no lockfile. That is also the constraint on what may live here:
**a file under `scripts/` may import node builtins and its own siblings, nothing
else.** Bare specifiers resolve by walking up from the importing file, so a
third-party import here finds no `node_modules` and fails — which is why the
generator's one dependency is handed in from the package that has it, rather
than imported where the shared logic lives.

Nothing formats or lints this directory: `format-touched` buckets a path by its
first segment and no package owns `scripts/`, and neither eslint config reaches
outside its own package. Match the surrounding style by hand — both packages'
prettier agrees (100 columns, single quotes, semicolons, two-space indent).
`repo-ci.yaml` does shellcheck the `.sh` here, which is lint of a sort, but
nothing formats anything under `scripts/`.

## The root `docs/` directory

Prose about the product rather than about one package. `docs/feature-research.md`
is the 251-feature survey of the category and the owner's build/decline decision
on every row — the roadmap the whole repository works from, web and CLI included.
It lived in `api/docs/` until it was moved here, which put the product roadmap
behind a package boundary that web-side work never crosses.

The test for what belongs here is who the reader is, not where the subject is
implemented: `api/docs/scaling.md` stays in `api/` because it is the api's own
measured behaviour, keyed to `api/bench/` and `pnpm -C api run bench`, and
nothing in it means anything to `web/`.

Nothing checks a commit that touches only this directory — it matches no
package's `paths:` filter, so the run is `ci-gate.yaml` and `preview-build`,
which is the same thing that is already true of the root prose files.

## Git hooks and workflows

`.githooks/` at the root is the only hook directory git uses (`core.hooksPath`,
written by either package's `prepare`). `post-commit` and `post-rewrite` hand
the paths a commit touched to `format-touched`, which buckets each by its first
segment and runs **that package's own** eslint and prettier; a package with no
config or no installed binary is named in a warning and skipped, rather than
quietly reformatted to prettier's defaults. Never run `prettier --write` or
`eslint --fix` by hand.

That script has tests — `.githooks/tests/format-touched.test.sh`, nineteen cases
run by `repo-ci.yaml` and by nothing else. They stub `git` and `pnpm` onto the
front of PATH, so they need no repository, no `node_modules` and no network:

```sh
sh .githooks/tests/format-touched.test.sh   # about a second
```

Add a case for anything you change in a hook. Every bug this code has ever had
exits 0 — a bucket handed another package's paths, a fixer that could not start,
an amend that swallowed unstaged work — so a test asserting *which* paths reached
*which* package is the only thing that sees it. One known limitation is pinned
there rather than fixed: a path containing a space reaches the fixers split in
two, is reported, and is left unformatted. Fixing it means NUL-delimited
plumbing through `post-commit` and `post-rewrite` too, since both split their
file lists on whitespace before `format-touched` sees them.

Twelve workflows under `.github/workflows/`, each filtered to the packages it
checks. No pnpm command in CI runs at the root: every one carries `-C <package>`
or a `working-directory`, and every `setup-node` names an explicit
`cache-dependency-path`, because there is no root lockfile. Root-level files no
longer fall through the gaps between the package filters: `codegen-ci.yaml`
triggers on `scripts/**` because both clients are generated from what lives
there, `repo-ci.yaml` on `.githooks/**`, `scripts/**` and
`.github/workflows/**` — the three root-level things no package owns, the last
of them including the gate itself — and `ci-gate.yaml` is filtered to nothing on
purpose. Nothing *checks* a commit of only root prose,
but two workflows still run on it: `ci-gate.yaml` and `preview-build`, both
deliberately unfiltered, so a pull request always reports at least those two.
`k8s-ci.yaml` is the same shape one level down — `api/k8s/**` sits
inside api-ci's filter but no job there reads a manifest, so it is the one thing
that validates what `api-deploy.yaml` applies to production. `infra-ci.yaml`
covers `infra/**`, which no package filter reaches at all: it runs
`terraform fmt -check`, `init -backend=false` and `validate`. It cannot plan —
that needs the real state and credentials no pull-request workflow may hold — so
it catches a broken configuration and not a wrong one.

Every workflow that checks something must also be named in `ci-gate.yaml`'s
`is_blocking` (or `is_advisory`). An unlisted name fails the gate by design, so
adding a workflow is two edits, not one — and `repo-ci.yaml` checks the pair
statically, so a missed second edit fails on the pull request that made it
rather than on every pull request after it. Renaming a workflow is the same two
edits.

Filtering happens in two layers, and they are not interchangeable. A workflow's
`paths:` is the outer bound — the packages it could have something to say about
— and narrowing it drops coverage leaving no run behind to notice. Refining
happens **inside**: `api-ci.yaml` and `web-ci.yaml` each have a `changes` job
that diffs the event's own range and gates every other job on an `if:`. An
`api/k8s/**` edit still starts api-ci and still reports, but skips four
Postgres shards and two image builds; a `web/README.md` edit skips everything in
web-ci but the static group, and a `web/public/**` edit everything but the
build. Both lists are subtractive on purpose — a path nobody has classified
falls through to its package and costs a job, where an allowlist would drop it
and cost the coverage instead. Both fail open, loudly, when the event's base ref
cannot be resolved: running too much is always correct, skipping silently never
is.

## What makes CI enforceable

`ci-gate.yaml` exists because path filtering and required status checks are in
direct conflict: a workflow its filter excludes produces no check run, and
GitHub leaves a required check with no check run at "Expected — waiting for
status" indefinitely. Requiring API CI would block every web-only pull request
and vice versa, so nothing could be required and every check was advisory. The
gate is the one workflow with no `paths:`; it reads the other runs' results for
the head commit and fails if any of them did not pass. **`ci-gate` is the check
to require in branch protection** — that is a manual step in the GitHub UI, and
the file's header explains the mechanism, the two shapes that look correct and
are not, and why a skipped job is a *green* required check.

`.github/` also holds `CODEOWNERS`, which claims the four paths that reach
production and that no check reads for *intent* (`infra/`, `api/k8s/`,
`.github/`, `.githooks/`) plus this file, and `pull_request_template.md`, whose
only real job is to put the two-commit deploy rule in front of a human — it has
otherwise lived only here, where agents read it and nobody else does.
