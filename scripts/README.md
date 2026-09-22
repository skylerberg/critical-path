# Repository-root scripts

Shared tooling that belongs to no single package. **This directory is not a
package** — no `package.json`, no `node_modules`, no lockfile — so anything here
may import node builtins and its own siblings and nothing else: bare specifiers
resolve by walking up from the importing file, and the root has no
`node_modules`. See the root `AGENTS.md`.

## `bootstrap.sh`

A clone that has never been built here, to one that can run the tests, in one
command.

```sh
scripts/bootstrap.sh
```

In order: it seeds each untracked `.env` from the tracked example beside it,
never overwriting one that is already there; it checks node, pnpm, and that
something is listening where `api/.env.test` points Postgres and Redis,
reporting every missing one together; it installs each package and asserts a
`node_modules` appeared, since an exit status is not proof of one; it migrates
the test database; and it fetches Playwright's browsers. Packages come from
`git ls-files`, so a fifth one needs no edit here.

The seeding is why it exists: `api/.env.test` is untracked and every api test
script runs with `--env-file=.env.test`, so node exits without it. Migrating
the test database is not strictly required — the suite creates and migrates its
own in `globalSetup` — but it is the cheapest honest proof that the Postgres
half works. The *dev* database is deliberately not created for you; the closing
message names the two commands.

## `check-all.sh`

Every check CI runs that a laptop can, cheapest first. Run it before pushing.

```sh
scripts/check-all.sh
scripts/check-all.sh --fast   # the tier that needs no database, browser or bundler
```

It sequences the four packages' `check:all` and the three root checks no package
owns — the prose gate, its selftest and the `.githooks` test suite — and
regenerates the API clients so that the drift `codegen-ci.yaml` looks for fails
here first. Nothing is reimplemented, and nothing is forwarded to a package
either (root `AGENTS.md` covers what pnpm does to a forwarded `--`). The
`commands` job in `repo-ci.yaml` keeps the expansion honest: each package has
to be reached, and every file the script invokes has to exist.

Regenerating the clients is the one step that writes; everything else only
reads. The script's header lists what a green run does not cover. One gap is
quieter than those: the browser probes exit 0 with a warning when Playwright's
browsers are missing, which is what `bootstrap.sh` fetching them is for.

## `check-comments.mjs`

The prose gate for the whole repository: every package's code comments, plus the
markdown at the root, under `docs/` and inside each package.

```sh
node scripts/check-comments.mjs             # from anywhere; it resolves its own location
node scripts/check-comments.mjs --selftest
```

It reports two things: a rationale that exists in two files at once, and a name
or a path that no longer points at what the sentence around it says it does.
Give the first one owner — the module implementing the rule — and cut the other
site down to what is local there. `comment-allowlist.txt` covers the case where
there is no owner to give it to, and an entry in it that suppresses nothing is
reported too.

`--selftest` re-runs both checks over text planted to be wrong and fails if
either comes back clean; run it after changing what they assert. The header of
the script itself carries the rest — which extensions are read for prose, which
are only indexed for the names they declare, and what is skipped outright.

`repo-ci.yaml` runs both on every pull request. That workflow carries no
`paths:` filter for this reason: renaming or deleting any file at all can turn
a sentence somewhere else into a broken reference.

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
the committed clients differ from what it produces. It needs no `.env`, no
database and no running server.

## `lib/`

The OpenAPI client generator itself, shared by `web/` and `cli/`.

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

## `setup-hooks.mjs`

Points `core.hooksPath` at the root `.githooks/`. All four packages run it from
their `prepare`, so `pnpm -C <pkg> install` wires the hooks for the whole
checkout whichever package you installed.

Each `prepare` tests for the file before running it:

```sh
if [ -f ../scripts/setup-hooks.mjs ]; then node ../scripts/setup-hooks.mjs; fi
```

The test is what keeps the Docker builds working: `api/Dockerfile` and
`preview-edge/Dockerfile` each take their own package directory as the build
context, so `../scripts` is not in it, and `pnpm install` runs `prepare`
regardless. The guard belongs in the caller because a script cannot test for
its own absence.

## `new-worktree.sh`

Creates a worktree that can actually run the checks — the thing a bare
`git worktree add` does not give you, since it hands over tracked files and no
`node_modules`, and the api suite then dies much later on a missing `.env.test`.

```sh
scripts/new-worktree.sh <branch> [base-ref]
scripts/new-worktree.sh --only api,web <branch>
```

It creates `~/.worktrees/<repo>/<branch>` — outside the repository on purpose,
so no recursive search has a second copy of the codebase to walk — copies the
untracked `.env` files (which live in `api/`, not at the checkout root), and
runs `pnpm install` in every package. Packages are discovered from
`git ls-files '*/package.json'` rather than listed, so a fifth one needs no
edit here, and each install is asserted to have left a `node_modules` behind
rather than trusted for exiting 0 — which is what a stray root
`pnpm-workspace.yaml` would hand you. `--only` narrows the installs and fails
on a name that is not a package; the `.env` files are copied either way.

Everything is resolved from the git checkout it is **run in**, not from where
this file lives, so running it from a package subdirectory is fine.

It lives here rather than in `api/scripts/` because `api-deploy.yaml` filters on
`api/scripts/**`: a four-package developer script there would ship a production
API release on every edit.

Nothing formats or lints `scripts/` — match the surrounding style by hand (100
columns, single quotes, semicolons, two-space indent). The exception is lint on
the `.sh` files: `repo-ci.yaml` shellchecks every file under `.githooks/` and
`scripts/` whose shebang names a shell, and syntax-checks each under the shell
it declares.
