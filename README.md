# Critical Path

A project-management suite — kanban boards, task dependency graphs and
critical-path highlighting — in one repository with four packages.

| Package         | What it is                                      | Its docs                         |
| --------------- | ----------------------------------------------- | -------------------------------- |
| `api/`          | TypeScript API: Hono + Kysely + PostgreSQL      | `api/README.md`, `api/CLAUDE.md` |
| `web/`          | Svelte 5 SPA + PWA on Vite. No SvelteKit        | `web/README.md`, `web/CLAUDE.md` |
| `cli/`          | `cpath`, a full command-line client for the API | `cli/README.md`, `cli/CLAUDE.md` |
| `preview-edge/` | the Cloud Run worker that serves PR previews    | `preview-edge/README.md`         |

Two directories are not packages. `infra/terraform/` is the terraform for all of
it — the load balancer that fronts `api/` and `web/`, the bucket the web build is
uploaded to, the Cloud Run service that serves previews. `docs/` is the prose
about the product rather than about one package: `docs/feature-research.md`
surveys the category and records the accepted/declined decision on all 251
features, which is where the roadmap comes from.

`CLAUDE.md` at the root is the working manual for anyone — human or agent —
changing code here. It is worth reading before the first pull request.

## Requirements

Node.js >= 22, pnpm (each package pins its own version via `packageManager`),
and PostgreSQL 18 on `127.0.0.1:5432`. No Docker, no Supabase.

## Install

**This is not a pnpm workspace.** There is no root `package.json`, no root
`node_modules` and no root `pnpm-workspace.yaml` — install each package where it
lives, and never add a workspace file at the top. `CLAUDE.md` explains what
happens if you do, which is worse than it sounds: the install reports success.

```sh
pnpm -C api install
pnpm -C web install
pnpm -C cli install
pnpm -C preview-edge install
```

For a branch, use `scripts/new-worktree.sh <branch>` instead — it does all four,
plus the untracked `.env` files. See below.

## Running the API and the web app together

Follow `api/README.md` for creating the databases and writing `api/.env`, then
start the two servers in two terminals:

```sh
pnpm -C api run dev     # http://localhost:3001
pnpm -C web run dev     # http://localhost:5173
```

The API has to be up first: Vite proxies `/api` and `/ws` from 5173 to 3001, and
`API_PROXY_TARGET` moves that proxy if the API is on another port.

## The CLI

```sh
pnpm add --global ./cli     # after `pnpm -C cli install`
cpath board "My Project"
```

`cpath` defaults to the production instance, so point it somewhere else before
experimenting. `cli/README.md` is the command reference.

## Regenerating the API clients

`web/` and `cli/` each generate their API client from `api/`'s OpenAPI and
realtime documents, and the four generated files are committed. One command
rebuilds all of them:

```sh
scripts/generate-clients.sh
```

Run it after changing an API schema or a realtime payload, and commit its output
with the change. It works from any directory and needs no `.env`, no database
and no running server. `codegen-ci.yaml` runs the same script and fails a pull
request whose committed clients do not match.

## What else is in `scripts/`

It belongs to no package and is not one itself.

```sh
scripts/new-worktree.sh <branch> [base-ref]   # or --only api,web
node scripts/check-comments.mjs               # the prose gate; about a second
```

`new-worktree.sh` creates `~/.worktrees/<repo>/<branch>` — outside the
repository, so that no recursive search finds a second copy of the codebase —
copies the untracked `.env` files, which live in `api/` rather than at the
checkout root, and installs every package. Make every worktree with it; a
hand-made one fails the checks for reasons unrelated to the change in it.

`check-comments.mjs` reads every package's comments and markdown and fails on
two things a reviewer cannot check by eye: one rationale living in two files,
and a file or symbol that prose names but that does not resolve.
`scripts/README.md` covers both in full.

## Checks

Each package runs its own, from its own directory — `pnpm -C api test`,
`pnpm -C web run check:all`, `pnpm -C cli run check`,
`pnpm -C preview-edge run test`.

CI mirrors that split across twelve workflows, each filtered to the paths it
covers: `api-ci.yaml` and `web-ci.yaml` for the two large packages, plus
`codegen-ci.yaml` for the generated clients, `repo-ci.yaml` for `.githooks/`,
`scripts/` and the workflow files, `k8s-ci.yaml` for the manifests and
`infra-ci.yaml` for the terraform. Because every one of those is path-filtered,
none can be a required status check on its own — a workflow its filter excludes
produces no check run at all, and GitHub waits on it forever. `ci-gate.yaml` is
unfiltered, reads the others' results and fails if any of them did not pass.
Require its **`ci-gate`** job in branch protection and require nothing else —
it reports on behalf of all the others. Making that setting is a click in
GitHub's Settings UI; nothing in the repository can do it.

Do not run `prettier --write` or `eslint --fix` by hand. `.githooks/post-commit`
runs each package's own formatter over the files that package's commits touched
and amends the result in.

## Two merges, api first

**An endpoint and the web code that calls it must not land in the same merge.**
One push starts both production deploys, web finishes roughly two minutes ahead
of api, and for that window real users load a bundle calling an endpoint the
running pods do not serve yet. Merge the api half, wait for it, then open the
web half. Deletions run in the opposite order. Two commits in one pull request
do not satisfy this.

This is the rule most likely to be broken by accident here, because nothing
enforces it and nothing turns red when it is violated. `CLAUDE.md` has the
measurements behind it, the reason the generated clients are exempt, and the
matching discipline for database migrations.
