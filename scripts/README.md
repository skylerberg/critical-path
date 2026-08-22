# Repository-root scripts

Shared tooling that belongs to no single package. **This directory is not a
package** — no `package.json`, no `node_modules`, no lockfile — so anything here
may import node builtins and its own siblings and nothing else. Bare specifiers
resolve by walking up from the importing file, and the root has no
`node_modules` and never will. See the root `CLAUDE.md`.

## `generate-clients.sh`

Regenerates all four committed API clients from the api sources in this working
tree: `api`'s two spec dumps, then web's two clients, then the CLI's two.

```sh
scripts/generate-clients.sh     # from anywhere; it resolves its own location
```

Run it after changing an API request/response schema (`api/src/schemas/*.ts`) or
a realtime payload, and commit `web/src/api/*.generated.ts` and
`cli/src/api/*.generated.ts` with the change that caused them.
`.github/workflows/codegen-ci.yaml` runs the same script and fails the build if
the committed clients differ from what it produces — that workflow's header
explains why committing them alongside the api change is compatible with the
root `CLAUDE.md`'s two-commit deploy rule.

It needs no `.env`, no database and no running server.

## `lib/`

The OpenAPI client generator itself, shared by `web/` and `cli/`, which used to
be two diverging copies.

| File                  | What it holds                                              |
| --------------------- | ---------------------------------------------------------- |
| `generate-client.mjs` | the two generators end to end: load, filter, header, write |
| `spec-source.mjs`     | finding a dump, re-dumping it, and the freshness check     |
| `openapi-filter.mjs`  | dropping deprecated operations and the schemas they orphan |
| `repo-paths.mjs`      | where the repository and the api package are               |

Each package keeps only a wrapper (`web/scripts/generate-api-types.mjs` and its
three siblings) supplying `openapi-typescript` — which cannot be resolved from
here — and the path to write. Those wrappers are the same text below their
opening comments, and `web/scripts/generate-client.test.mjs` fails if they stop
being; it is also where this directory's behaviour is tested, since neither
package's own checks reach outside itself.

## `new-worktree.sh`

Creates a worktree that can actually run the checks — the thing a bare
`git worktree add` does not give you, since it hands over tracked files and no
`node_modules`, and the api suite then dies much later on a missing `.env.test`.

```sh
scripts/new-worktree.sh <branch> [base-ref]
scripts/new-worktree.sh --only api,web <branch>
```

It creates `~/.worktrees/<repo>/<branch>` — outside the repository on purpose, so
no recursive search has a second copy of the codebase to walk — copies the
untracked `.env` files (which live in `api/`, not at the checkout root), and runs
`pnpm install` in every package. Packages are discovered from
`git ls-files '*/package.json'` rather than listed, so a fifth one needs no edit
here, and each install is asserted to have left a `node_modules` behind rather
than trusted for exiting 0 — which is exactly what a stray root
`pnpm-workspace.yaml` hands you (`No projects found`, exit 0, nothing installed).
`--only` narrows the installs and fails on a name that is not a package; the
`.env` files are copied either way.

Everything is resolved from the git checkout it is **run in**, not from where
this file lives, so it works from a sibling project's directory too, and running
it from a package subdirectory is fine.

It lives here rather than in `api/scripts/` because `api-deploy.yaml` filters on
`api/scripts/**`: while it sat there, editing this developer-only script pushed a
production API release.

Nothing formats or lints `scripts/`: the `post-commit` hook buckets a path by
its first segment and no package owns this one. Match the surrounding style by
hand — both packages' prettier config agrees (100 columns, single quotes,
semicolons, two-space indent).

The two `.sh` here are the exception, and only for lint: `repo-ci.yaml`
shellchecks every file under `.githooks/` and `scripts/` whose shebang names a
shell, and syntax-checks each under the shell it declares — bash here, POSIX sh
for the hooks. The `.mjs` under `lib/` are still covered by nothing.
