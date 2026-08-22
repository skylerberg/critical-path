# Repository-root scripts

Shared tooling that belongs to no single package. **This directory is not a
package** — no `package.json`, no `node_modules`, no lockfile — so anything here
may import node builtins and its own siblings and nothing else. Bare specifiers
resolve by walking up from the importing file, and the root has no
`node_modules` and never will. See the root `CLAUDE.md`.

## `bootstrap.sh`

A clone that has never been built here, to one that can run the tests, in one
command.

```sh
scripts/bootstrap.sh
```

In order: it seeds each untracked `.env` from the tracked example beside it,
never overwriting one that is already there; it checks node, pnpm, and that
something is listening where `api/.env.test` points Postgres and Redis,
reporting every missing one together rather than one per run; it installs each
package and asserts a `node_modules` appeared, since an exit status is not
proof of one; it migrates the test database; and it fetches Playwright's
browsers. Packages come from `git ls-files` the way they do below, so a fifth
one needs no edit here either.

The seeding is why it exists. `api/.env.test` is untracked, every api test
script is run with `--env-file=.env.test`, and node exits rather than continue
without it — and until this there was no example of that file to copy, so the
one people lost was the one with nothing to lose it from. `REDIS_TEST_URL` is
in that example, which is also why an unreachable Redis stops this script
instead of being mentioned in passing: the two files that drive a real server
skip politely when the variable is absent and fail outright when it names a
port nobody is listening on.

Migrating the test database is not strictly required — the suite creates and
migrates its own in `globalSetup`. It is the cheapest honest proof that the
Postgres half works: a role that cannot create databases fails here in a second
with the migrator's own message, rather than three minutes into a run. The
*dev* database is deliberately not created for you, since that is a change
outside the checkout; the closing message names the two commands.

## `check-all.sh`

Every check CI runs that a laptop can, cheapest first. Run it before pushing.

```sh
scripts/check-all.sh          # ~9m30s
scripts/check-all.sh --fast   # ~1m
```

It sequences the four packages' `check:all` and the three root checks no package
owns — the prose gate, its selftest and the `.githooks` test suite — and
regenerates the API clients so that the drift `codegen-ci.yaml` looks for fails
here first. api's and web's are expanded into the scripts they compose, purely
so the order can be by measured time: nothing in the first tier needs a
database, a browser or a bundler, which is what holds it to a minute, and
`--fast` stops at the end of it. Nothing is reimplemented, and nothing is
forwarded to a package either — `pnpm test -- --shard=1/4` runs everything and
passes, so this takes no arguments on their behalf at all.

The `commands` job in `repo-ci.yaml` keeps that expansion honest: each package
has to be reached either by its own `check:all` or by every script `check:all`
names, and every file the script invokes has to exist. Renaming a package
script leaves this file parsing perfectly and failing on whoever runs it next,
and nothing else in the tree would notice.

Regenerating the clients is the one step that writes; everything else only
reads.

The script's header lists what a green run does not cover, all of it wanting a
tool nothing here installs: the two image builds, the manifest validation, the
terraform, and the shellcheck and actionlint that `repo-ci.yaml` fetches by
checksum. One gap is quieter than those and worth repeating — the browser
probes exit 0 with a warning when Playwright's browsers are missing, so
`check:browser` can be green on a laptop and red on a runner, which is what
`bootstrap.sh` fetching them is for.

## `check-comments.mjs`

The prose gate for the whole repository: every package's code comments, plus the
markdown at the root, under `docs/` and inside each package.

```sh
node scripts/check-comments.mjs             # from anywhere; it resolves its own location
node scripts/check-comments.mjs --selftest
```

It reports two things, both of which a reader would otherwise take on trust: a
rationale that now exists in two files at once, and a name or a path that no
longer points at what the sentence around it says it does. Give the first one
owner — the module implementing the rule — and cut the other site down to what
is local there. `comment-allowlist.txt` covers the case where there is no owner
to give it to, and an entry in it that suppresses nothing is reported too, so it
cannot silently become a list of things nobody re-checked.

`--selftest` re-runs both checks over text planted to be wrong and fails if
either comes back clean; run it after changing what they assert. The header of
the script itself carries the rest — which extensions are read for prose, which
are only indexed for the names they declare, and what is skipped outright.

`repo-ci.yaml` runs both of those on every pull request. That workflow carries no
`paths:` filter for this reason: renaming or deleting any file at all, prose or
not, can turn a sentence somewhere else into a broken reference.

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

## `setup-hooks.mjs`

Points `core.hooksPath` at the root `.githooks/`. All four packages run it from
their `prepare`, so `pnpm -C <pkg> install` wires the hooks for the whole
checkout whichever package you installed — which is what installing only `cli/`
or only `preview-edge/` used to leave undone.

One copy here rather than four beside the packages, on the same terms as
`check-comments.mjs`: node builtins only, so it resolves from a root with no
`node_modules`. Until this moved it was two byte-identical files in `api/` and
`web/`, held in step by a declared mirror in `check-comments.mjs`.

Each `prepare` tests for the file before running it:

```sh
if [ -f ../scripts/setup-hooks.mjs ]; then node ../scripts/setup-hooks.mjs; fi
```

The test is what keeps the Docker builds working. `api/Dockerfile` and
`preview-edge/Dockerfile` each take their own package directory as the build
context, so `../scripts` is not in it, and `pnpm install` runs `prepare`
regardless — `--frozen-lockfile` and `--prod` included. Unguarded, the image
build dies on MODULE_NOT_FOUND during dependency installation. The guard belongs
in the caller because a script cannot test for its own absence.

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
hand — all four packages' prettier config agrees (100 columns, single quotes,
semicolons, two-space indent).

The `.sh` files here are the exception, and only for lint: `repo-ci.yaml`
shellchecks every file under `.githooks/` and `scripts/` whose shebang names a
shell, and syntax-checks each under the shell it declares — bash here, POSIX sh
for the hooks. The `.mjs` under `lib/` have their prose read by
`check-comments.mjs`, along with every other file in the tree; no linter and no
formatter reaches them at all.
