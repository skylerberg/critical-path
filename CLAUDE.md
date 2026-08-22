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

## Git hooks and workflows

`.githooks/` at the root is the only hook directory git uses (`core.hooksPath`,
written by either package's `prepare`). `post-commit` and `post-rewrite` hand
the paths a commit touched to `format-touched`, which buckets each by its first
segment and runs **that package's own** eslint and prettier; a package with no
config or no installed binary is named in a warning and skipped, rather than
quietly reformatted to prettier's defaults. Never run `prettier --write` or
`eslint --fix` by hand.

Seven workflows under `.github/workflows/`, each filtered to the packages it
checks. No pnpm command in CI runs at the root: every one carries `-C <package>`
or a `working-directory`, and every `setup-node` names an explicit
`cache-dependency-path`, because there is no root lockfile. A commit touching
only root-level files matches no filter and runs no CI at all.
