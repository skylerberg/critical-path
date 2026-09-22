# Critical Path

A project-management suite — kanban boards, task dependency graphs and
critical-path highlighting — in one repository with four packages.

| Package         | What it is                                      | Its docs                         |
| --------------- | ----------------------------------------------- | -------------------------------- |
| `api/`          | TypeScript API: Hono + Kysely + PostgreSQL      | `api/README.md`, `api/AGENTS.md` |
| `web/`          | Svelte 5 SPA + PWA on Vite. No SvelteKit        | `web/README.md`, `web/AGENTS.md` |
| `cli/`          | `cpath`, a full command-line client for the API | `cli/README.md`, `cli/AGENTS.md` |
| `preview-edge/` | the Cloud Run worker that serves PR previews    | `preview-edge/README.md`         |

Two directories are not packages. `infra/terraform/` is the terraform for all of
it — the load balancer that fronts `api/` and `web/`, the bucket the web build
is uploaded to, the Cloud Run service that serves previews. `docs/` holds prose
about the product rather than about one package: `docs/feature-research.md`
surveys the category and records the build/decline decision on every feature,
which is where the roadmap comes from.

`AGENTS.md` at the root is the working manual for anyone — human or agent —
changing code here. It is worth reading before the first pull request.

## Requirements

Node.js >= 22, pnpm (each package pins its own version via `packageManager`),
and PostgreSQL 18 on `127.0.0.1:5432`. No Docker, no Supabase.

## Install

A fresh clone reaches a state that can run the tests in one command:

```sh
scripts/bootstrap.sh
```

It seeds the untracked `.env` files from their tracked examples, reports
missing prerequisites, installs all four packages, migrates the test database
and fetches Playwright's browsers. Running it a second time is safe.

Underneath it, and worth knowing before the first one goes wrong:

**This is not a pnpm workspace.** There is no root `package.json`, no root
`node_modules` and no root `pnpm-workspace.yaml` — install each package where
it lives, and never add a workspace file at the top. `AGENTS.md` explains what
happens if you do, which is worse than it sounds: the install reports success.

```sh
pnpm -C api install
pnpm -C web install
pnpm -C cli install
pnpm -C preview-edge install
```

For a branch, use `scripts/new-worktree.sh <branch>` instead — it does all
four, plus the untracked `.env` files.

## Running the API and the web app together

Follow `api/README.md` for creating the databases and writing `api/.env`, then
start the two servers in two terminals:

```sh
pnpm -C api run dev     # http://localhost:3001
pnpm -C web run dev     # http://localhost:5173
```

The API has to be up first: Vite proxies `/api` and `/ws` from 5173 to 3001,
and `API_PROXY_TARGET` moves that proxy if the API is on another port.

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
rebuilds all of them, from any directory:

```sh
scripts/generate-clients.sh
```

Run it after changing an API schema or a realtime payload, and commit its
output with the change. `codegen-ci.yaml` runs the same script and fails a pull
request whose committed clients do not match.

## Checks

Before pushing, one command runs every check CI runs that a laptop can:

```sh
scripts/check-all.sh
scripts/check-all.sh --fast   # stops short of the suites and the probes
```

Its header names what a green run still does not promise. Each package also
runs its own, from its own directory, under the same name in all four:
`pnpm -C <pkg> run check:all`; `type-check`, `lint` and `format:check` mean the
same thing everywhere too (web's type checker is `svelte-check`).

CI mirrors that split across path-filtered workflows, and `ci-gate.yaml` is the
one unfiltered one: it reads the others' results and fails if any did not
pass. Require its **`ci-gate`** job in branch protection and nothing else — the
root `AGENTS.md` explains why nothing else can be required.

Do not run `prettier --write` or `eslint --fix` by hand:
`.githooks/post-commit` runs each package's own formatter over the files that
commit touched and amends the result in.

## Two merges, api first

**An endpoint and the web code that calls it must not land in the same merge.**
One push starts both production deploys and web's finishes first, so for that
window the deployed bundle calls an API that has not restarted yet. Merge the
api half, wait for it, then open the web half; deletions run in the opposite
order, and two commits in one pull request do not count. The root `AGENTS.md`
has the full rule, including why the generated clients are exempt.
