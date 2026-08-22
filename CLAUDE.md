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

## Git hooks and workflows

`.githooks/` at the root is the only hook directory git uses (`core.hooksPath`,
written by either package's `prepare`). `post-commit` and `post-rewrite` hand
the paths a commit touched to `format-touched`, which buckets each by its first
segment and runs **that package's own** eslint and prettier; a package with no
config or no installed binary is named in a warning and skipped, rather than
quietly reformatted to prettier's defaults. Never run `prettier --write` or
`eslint --fix` by hand.

Eight workflows under `.github/workflows/`, each filtered to the packages it
checks. No pnpm command in CI runs at the root: every one carries `-C <package>`
or a `working-directory`, and every `setup-node` names an explicit
`cache-dependency-path`, because there is no root lockfile. A commit touching
only root-level files matches no filter and runs no CI at all — with one
exception, `codegen-ci.yaml`, which does trigger on `scripts/**` because both
clients are generated from what lives there.
