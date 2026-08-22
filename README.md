# Critical Path

A project-management suite — kanban boards, task dependency graphs and
critical-path highlighting — in one repository with four packages.

| Package         | What it is                                                        |
| --------------- | ----------------------------------------------------------------- |
| `api/`          | TypeScript API: Hono + Kysely + PostgreSQL. Serves `/api` and `/ws`. |
| `web/`          | Svelte 5 SPA + PWA, built with Vite. No SvelteKit.                 |
| `cli/`          | `cpath`, a full command-line client for the API.                   |
| `preview-edge/` | The Cloud Run worker that serves pull-request previews.            |

Each package has its own `package.json`, `pnpm-lock.yaml` and
`pnpm-workspace.yaml`; `api/` and `web/` also have their own `README.md`, and
the CLI is documented in `api/README.md`. **This is not a pnpm workspace** —
install each package where it lives, and never add a `pnpm-workspace.yaml` at
the repository root. `CLAUDE.md` explains why.

## Requirements

Node.js >= 22, pnpm (each package pins its own version via `packageManager`),
and PostgreSQL 18 on `127.0.0.1:5432`. No Docker, no Supabase.

## Running the API and the web app together

```sh
pnpm -C api install
pnpm -C web install
```

Then follow `api/README.md` for the databases and `api/.env`, and start the two
servers in two terminals:

```sh
pnpm -C api run dev     # http://localhost:3001
pnpm -C web run dev     # http://localhost:5173
```

The API has to be up first: Vite proxies `/api` and `/ws` from 5173 to 3001, and
`API_PROXY_TARGET` moves that proxy if the API is on another port.

## The CLI

```sh
pnpm -C cli install
pnpm add --global ./cli     # installs the global `cpath` command
```

`api/README.md` has the command reference.

## Regenerating the API clients

`web/` and `cli/` each generate their API client from `api/`'s OpenAPI and
realtime documents, and the four generated files are committed. One command
rebuilds all of them:

```sh
scripts/generate-clients.sh
```

Run it after changing an API schema or a realtime payload, and commit its output
with the change. It works from any directory and needs no `.env`, no database
and no running server. `.github/workflows/codegen-ci.yaml` runs the same script
and fails if the committed clients do not match; `scripts/README.md` has the
details.

## Checks

Each package runs its own, from its own directory — `pnpm -C api test`,
`pnpm -C web run check:all`, `pnpm -C cli run check`. CI is split the same way:
`.github/workflows/api-ci.yaml` and `web-ci.yaml`, each filtered to the paths it
covers, plus `codegen-ci.yaml` for the generated clients.

Do not run `prettier --write` or `eslint --fix` by hand. The repository's
`.githooks/post-commit` runs each package's own formatter over the files that
package's commits touched and amends the result in.
