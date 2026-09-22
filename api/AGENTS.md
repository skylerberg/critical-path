# critical-path — `api/`

Backend for "Critical Path". Plain Postgres + Kysely — no Supabase, no Docker,
no OpenTelemetry.

This is one package of four in a monorepo (`api/`, `web/`, `cli/`,
`preview-edge/`). The root `AGENTS.md` carries what is true across all of them —
in particular the **two-commit deploy rule**, which this package's changes are
half of. `web/AGENTS.md` is the frontend's manual.

**Where commands run.** Unless it says otherwise, a bare `pnpm run …` or
`pnpm test` in this file is an api-package command: run it from `api/`, or as
`pnpm -C api run …` from the repository root. Anything naming another package
(`pnpm -C cli …`, `pnpm -C web …`) is written from the repository root; from
inside `api/` those are `pnpm -C ../cli …`.

# Package manager

pnpm, pinned by `packageManager` in each package.json. Four packages, four
lockfiles, four `pnpm-workspace.yaml` files, and no root workspace file — the
root `AGENTS.md` covers why.

`pnpm-workspace.yaml` is a settings file here, not a workspace declaration: none
of the four has a `packages:` key. pnpm 11 reads settings from nowhere else —
not `.npmrc` beyond auth and registry, not package.json's `pnpm` field. Keys are
camelCase; a kebab-case one is dropped without a word.

All four files turn `verifyDepsBeforeRun` **off** — the two failures behind that
are recorded in `api/pnpm-workspace.yaml`'s comment. `allowBuilds` gates whether
a dependency may run install scripts, and `strictDepBuilds` fails the install on
any that is unlisted — a denial counts, an omission does not. Adding a
dependency that builds means listing it there in the same commit.

# The two clients

`web/` is the Svelte 5 frontend for this API. Run the API first
(`pnpm -C api run dev`, port 3001), then the web app (`pnpm -C web run dev`,
port 5173) — Vite proxies `/api` and `/ws` to `localhost:3001`.

Both the web app and the `cli/` package generate their API client from this
package's OpenAPI spec: **a request/response schema change and both regenerated
clients belong in one commit.** One command does all of it, from any directory:

```sh
scripts/generate-clients.sh
```

`codegen-ci.yaml` runs the same script and fails if the committed clients
differ, so this is not optional. Committing them beside the api change does not
violate the two-commit deploy rule — the generated files declare types and no
runtime values; it is the *call sites* that wait for the second merge.

The script needs no `pnpm run openapi:dump` first — every generator re-dumps
before reading, and all of them resolve this package by a fixed in-repo path,
so a missing `api/` is a fatal error rather than a quiet fallback to the
deployed API. The generators are one program in `scripts/lib/` at the
repository root; each package keeps only its `openapi-typescript` dependency
and the path it writes.

Realtime and webhook event types come from a second document,
`realtime-events.json`, because `/ws` has no HTTP request or response to put in
the OpenAPI spec — see convention 14. It is dumped locally to `api/` and
gitignored, and served at `GET /api/realtime-events.json` so a client can
generate against a deployed API without a checkout.

# Conventions

1. All POST/PUT/PATCH/DELETE handlers run inside a database transaction via
   `transactionMiddleware`. Route handlers access the connection with
   `c.get('db')` — never import `db` directly in route handlers. There is no
   opt-out. Post-commit work (e.g. storage object deletion) goes through
   `c.get('postCommitHooks')`.
2. Authentication is global (`app.use('*', authMiddleware)`), not per-route. A
   route serves without a token only by carrying the `skipAuth` marker
   middleware, and `assertPublicRoutes` fails at boot if the marked set drifts
   from the list in `src/utils/assert-public-routes.ts`. Never add `skipAuth`
   via `use('*')` on a sub-router: it would match every sibling sharing that
   mount prefix. Routers that host public and authenticated routes together
   (`/api/auth`, `/api/images`, `/api/attachments`) export a second
   `PublicHono` router for their public half, because one Hono instance carries
   one context type: `AppHono` handlers get `AppContext` (where `c.get('user')`
   is a user), `PublicHono` handlers get `PublicContext` (where it is
   `AuthenticatedUser | undefined`). A service that never reads the user takes
   `Pick<PublicContext, 'get'>`; one that does takes `Pick<AppContext, 'get'>`,
   which is what stops a public route from reaching it.
3. POST endpoints take a client-supplied `id` (enables optimistic UI).
   Duplicate id → 409. Map Postgres unique violations (code 23505, see
   `isUniqueViolation`) to 409 in handlers — pre-checks alone race.
4. Every route gets `describeRoute` with tags, summary, description,
   `security: [{ bearerAuth: [] }]` when authed, response schemas via
   `resolver(arkSchema)`, and error responses spread from `src/schemas/errors.ts`.
5. Request body validation via `jsonValidator(schema)` (strips undeclared
   keys, fails 422 with `{ error, details }`).
6. Re-export every schema module from `src/schemas/index.ts`; the OpenAPI
   schema-name registry reads that barrel.
7. Text length limits are enforced with arktype, not DB CHECK constraints.
   Non-empty CHECKs exist only where empty is never valid (names, title,
   email, color).
8. All FKs are `ON DELETE CASCADE`; don't manually delete rows the DB
   cascades. The one exception is `project.created_by`, which is `ON DELETE
   RESTRICT`: an account cannot be deleted while it still owns a project, so
   ownership has to move (`PUT /api/projects/:id/owner`) or the project has to
   be deleted first.
9. Avoid N+1 queries; prefer one bulk query (`jsonArrayFrom` correlated
   subqueries) per screen-sized read.
10. Mutations with no useful body return `c.body(null, 204)`.
11. Comments: absolute minimum, only non-obvious why.
12. Project access is strict and centralized in `src/services/authorization.ts`:
    a project is visible to its creator (implicit, never stored as a member
    row, always an editor) and to its `project_member` rows, each carrying a
    `role` of `editor` or `viewer`. **404 for a caller with no access; 403 only
    for a caller who can already read the row.** Every project-scoped read
    asserts access (`assertProjectAccess` / `assertTaskAccess`); every
    project-scoped mutation asserts write (`assertProjectWrite` /
    `assertTaskWrite`). A new mutating route that asserts only access is a
    defect. Three categories are the deliberate exceptions, and all assert
    access rather than write: comments, because viewers may post, edit and
    delete their own; a row keyed to the calling user and observable by nobody
    else (`project_user_position`, `project_user_seen`); and
    `PUT /api/projects/:id/members`, which gates on the caller's role itself
    because a viewer may use it to remove themselves and nothing else. Roles
    are normalized fail-closed — anything that is not exactly `editor` reads as
    `viewer`. A `task_dependency` edge is the one thing that spans two
    projects: creating one asserts write on the blocked side and **read** on
    the blocker's, and removing one asserts write on the blocked side alone, so
    an edge whose far end became unreadable stays detachable. Anything that
    reads the far side of such an edge either filters on access and reports a
    bare count for what it dropped, or reports nothing at all — see
    `src/services/crossProjectBlockers.ts`.
13. Every mutation emits a realtime event via `publishAfterCommit` from
    `src/services/realtime` (runs as a post-commit hook, so nothing is
    published on rollback). Events about rows or access that are gone
    post-commit (`project_deleted`, membership-removal evictions) must
    snapshot `recipientUserIds` inside the transaction; events about live rows
    rely on the delivery layer's per-event access re-check. Every fact about a
    type — that it exists, whether it reaches webhook registrations, whether it
    raises the unseen-changes dot, whether its payload names the acting user,
    and whether it carries a project — is one row of the table in
    `src/services/realtime/eventCatalog.ts`. Adding a type there is what makes
    it publishable.
14. A type's **payload shape** is one row of a second table,
    `src/services/realtime/payloads.ts`, pinned to the catalog: a type with no
    payload row does not compile, and a payload that disagrees with its row is
    a type error at the publish site. Reuse the request/response schema the
    payload actually is (`boardTaskSchema`, `columnSchema`, …) instead of
    restating its fields, and never re-export this module from
    `src/schemas/index.ts`: the OpenAPI schema-name registry throws on two
    schemas with identical JSON Schema. `actor_user_id` is merged in from the
    catalog and required, which forces the publishers outside a request (the
    series sweep, the unfurl job) to name someone; `publishAfterCommit`
    therefore takes `CallerPayload<T>`, the payload minus that field.
    After changing a payload run `scripts/generate-clients.sh` and commit the
    regenerated clients in the same commit. The dump itself is gitignored like
    `openapi.json`.
15. Every `sort_key` is unique within its scope, and the `task` index spans
    archived rows on purpose, so a key a client computed — ranked against only
    the rows that client can see — is a request, not a value to store. The
    column type is `ResolvedSortKey`, a branded string in `src/db/types.ts`, and
    the request schemas produce a plain `string`: the only way across is
    `resolveSortKey`, `resolveSortKeys` (a batch resolved against each other as
    well as the scope) or `appendKeys`. Keep the residual `isUniqueViolation` →
    409 anyway: resolving reads the scope, and nothing holds it until the
    write. Raw `sql` writes bypass the brand — the bulk paths that use them
    take the column's tail advisory lock instead, and a new one must do the
    same, in that order (tail lock, then task rows) or it deadlocks against the
    bulk move.
16. Background work is pinned the same way realtime events are, across three
    tables. `src/services/jobs/payloads.ts` declares which kinds exist and the
    shape of each payload; `registerJobHandler` and `enqueueJob` are generic
    over its keys, so a kind with no row cannot be registered or enqueued and a
    payload that disagrees with its row is a type error at the enqueue site.
    `src/services/jobs/register.ts` is a `Record<JobKind, () => void>` against
    the same keys, so a kind that nothing runs does not compile, and it is
    called **once**, from the entrypoint beside the worker — never as an import
    side effect. `registeredJobKinds()` is both what `claimDueJobs` filters on
    and what `syncPeriodicJobs` retires schedules by, so a process holding a
    different subset than production leaves work unclaimed and deletes
    schedules it should not. Payloads carry ids and never contact details
    (`assertJobPayload`).
17. A route's response statuses are declared once, in the object built from
    `src/schemas/responses.ts` (`jsonResponse` / `emptyResponse` /
    `rawResponse`), and that same object is both spread into `describeRoute`'s
    `responses` and read back as the handler's return type through
    `Returned<typeof …>`. hono-openapi validates nothing at runtime, so without
    the pairing a handler can quietly stop answering what its own spec
    promises. Error bodies stay out of it: they come from thrown `AppError`s
    through `onError`, so they remain ordinary spreads from
    `src/schemas/errors.ts`.

# Realtime, email, and password reset

- WebSockets are served at `/ws` on the raw HTTP upgrade (see
  `src/services/realtime/transport.ts`); `/ws` is never part of the OpenAPI
  spec. Handshake: `{ type: 'auth', token }` within 10s, then
  `subscribe`/`unsubscribe` with a `project_id`; ping/pong heartbeat every 30s.
  The handshake token is either a session token or a personal access token.
  Three ceilings bound what one caller holds open: 200 live sockets per source
  address (refused in the handshake with 429 and then destroyed — `end()` alone
  half-closes), 20 per account (oldest closed with 4429, so a reconnect is
  never refused by the socket it is replacing), and 1000 subscriptions per
  socket. A `subscribe` naming anything that is not a uuid is ignored, and one
  that is gets lower-cased — a differently-cased one names a room no publish
  can reach. Only one `auth` frame per socket is ever acted on. All three
  ceilings are per process, so the fleet-wide figure is times the replica
  count — they bound what one process can be made to hold, not what one person
  may have.
  Credential revocation publishes `sessions_revoked` on the realtime bus, which
  closes sockets with code 4401: `{ user_id }` reaches that user's session
  sockets, and adding `personal_access_token_id` or `session_id` narrows it.
  Any new publisher must keep sending `user_id` — it is the dispatch fallback
  in `handleBusEntry`.
  Both application close codes are one table,
  `src/services/realtime/closeCodes.ts`, which `src/spec/realtime-events.ts`
  publishes as `RealtimeCloseCode`: a code added at a close site and not in
  that table reaches no client at all. The ping interval crosses the same way,
  from `src/services/realtime/heartbeat.ts` as `RealtimeHeartbeatMs` — a
  literal type, never a runtime value, that a client annotates its own copy of
  the number with, so raising it breaks the client's compile. Both changes
  carry the same `scripts/generate-clients.sh` obligation a payload change
  does.
- The realtime bus is in-process by default; when `REDIS_URL` is set (as in
  production, which runs 2+ replicas) publishes fan out via Redis pub/sub so
  every replica delivers to its own sockets. Rate limits also share Redis
  counters then, falling back to per-process windows if Redis is unreachable.
- Password-reset emails go through `src/services/email` (`EMAIL_DRIVER`:
  `console` default, `ses` loads the AWS SDK on first send; `assertEmailConfig`
  in `src/config/env.ts` fails the boot when `EMAIL_DRIVER=ses` names no from
  address or no region, because every send runs in a post-commit hook where a
  throw is caught and logged and the deploy looks healthy). Reset tokens are
  stateless HMAC (`PASSWORD_RESET_SECRET`, required in production), 15-minute
  TTL. Every link the server mails is built in `src/services/webLinks.ts` from
  `APP_URL_BASE`, never in the service that sends it: the paths are pinned
  there and again in `web/src/lib/router.test.ts`, so a route rename and its
  pin land in one commit. `POST /api/auth/forgot-password` answers 204 and
  enqueues the send for an address that has an account, 404 for one that does
  not, and 429 past either reset budget. It is deliberately informative:
  signup already answers 409 for an address in use, unauthenticated, so a
  non-revealing forgot-password would buy nothing.
- Every mailed-link token — password reset, email verification, unsubscribe —
  is one codec, `src/services/signedToken.ts`
  (`base64url(claims).base64url(hmac)`). The families share a secret
  (`EMAIL_TOKEN_SECRET` falls back to `PASSWORD_RESET_SECRET`), so separating
  them is what stops one family's token being spent as another's: the type is a
  required argument to both `encodeSignedToken` and `decodeSignedToken`, and is
  reserved from the claims object at the type level.
- Session expiry is idle-based. `SESSION_TTL_DAYS` is what a session gets from
  its last use, not from its creation: authenticating one past the halfway mark
  slides `expires_at` forward, on the pool rather than the request's
  transaction. Only the request that moved it re-issues the cookie, which is
  why `AuthenticatedCredential` carries `renewed`. The cap is the browser's: a
  cookie longer than 400 days is clamped silently, and `assertSessionConfig`
  turns that into a boot failure. Personal access tokens do not slide — theirs
  is an absolute `expires_at`, usually null.
- Neither `change-password` nor `reset-password` revokes anything: every
  session and token stays signed in. Sessions are revoked only from the
  sessions list (`DELETE /api/auth/sessions/:id`). Both flows do rotate
  `app_user.alternative_id`, the reset-token HMAC subject — that is what makes
  a reset link single-use, and it has nothing to do with sessions.

# CLI

`cli/` is a **sibling package** of this one (`critical-path-cli`, command
`cpath`), and `cli/AGENTS.md` is its operating manual. Three of its facts are
api-package facts and so belong here:

- **Its tests run in this package's suite.** `vitest.config.ts` includes
  `../cli/tests/**/*.test.ts`, and those tests drive the Hono app in-process, so
  a broken CLI fails `pnpm test` here — with api's `.env.test` and api's
  database underneath it.
- **Knip crosses the same boundary.** `../cli` is a workspace in `knip.json`,
  which resolves that package's imports against `cli/package.json`. It is
  unrelated to pnpm workspaces, which this repo still must not use.
- **Its dependencies are not yours.** It installs from its own lockfile, and
  that separation is what leaves `api-deploy.yaml`'s path filter unable to see
  a CLI dependency bump. Never add a CLI dependency to `package.json` here.

# Staying current with main

`main` moves fast, so a branch cut an hour ago is routinely behind, and nothing
tells you until a rebase conflicts or CI fails on a rule your base predates.
Rebase onto `main` (not merge: branches are rebased, only the PR itself lands
as a merge commit) and check at three points:

```sh
git fetch origin && git rev-list --count HEAD..origin/main -- api/   # 0 means current
```

**The pathspec is what makes that number mean anything** — one `main` serves
both projects, so the bare count is red almost always (root `AGENTS.md`). Drop
the pathspec deliberately when the change spans both packages, and read the
answer as two numbers. Being behind on the *other* package is not a reason to
rebase mid-change; it is a reason to rebase before you push.

1. **Before starting.** A stale base means writing against code that has moved.
   Run `gh pr list` and `git branch -a` too — the fix you are about to write
   may already be open.
2. **Before the full suite.** A minutes-long run against a stale base proves
   nothing about the merge.
3. **Before pushing, and again before merging.** `gh pr view <n> --json
   mergeStateStatus` reports `CLEAN` only for a branch that still applies.

After any rebase, re-run the checks rather than trusting the pre-rebase pass,
and re-run whatever generation the change involves — a rebase can bring in a
schema change that silently invalidates a committed generated file.

One conflict resolves wrongly by default: a branch cut before `openapi.json` or
`realtime-events.json` was untracked still carries the tracked copy, so merging
main raises a modify/delete conflict on it. Keep the deletion — the file is a
dump now. Taking "modified" silently puts a large generated file back under
version control, and `tests/unit/generatedDocuments.test.ts` is what fails when
it does. That guard scans the whole repository, matching by basename, so a
tracked dump under any package or at the root fails it.

Two ways a stale base produces *wrong* conclusions:

- **Comments about build configuration go stale.** Read `package.json` and
  `tsconfig.json` rather than a comment describing them.
- **"No diff" is not a passing check.** `git diff --quiet <file>` is vacuously
  clean for a gitignored file, and for one a failed command never wrote —
  `openapi.json` and `realtime-events.json` are both gitignored. Assert the
  positive: the command exited 0, the file was written, the content is what you
  expected.

# Running things

- `pnpm run dev` — API on port 3001.
- **Run only the tests your change touches; let CI run the rest.** A single
  file or directory is
  `node --env-file=.env.test node_modules/vitest/vitest.mjs run <path>`, run from
  `api/`, and takes seconds. A CLI test file is reached the same way with the
  `../` prefix, because those files are collected by this package's vitest. The
  full `pnpm test` takes minutes and needs the machine mostly to itself:
  several e2e tests drive dozens of sequential requests inside one `it` against
  a 30s `testTimeout`, and a browser or benchmark running alongside fails them
  at exactly that timeout, which reads like a hang and is not one. Re-run a
  failure alone before believing it.
- `pnpm run test:changed` answers "which files is that" for you: it diffs
  against `origin/main` (pass another base as an argument), including
  uncommitted and untracked files, and runs every test that reaches one through
  the real module graph. `pnpm run test:related <paths>` is the same thing for
  paths you name yourself. Neither replaces the suite: a file nothing imports
  yet resolves to no tests, and a test that breaks through shared state rather
  than an import is invisible to both.
- Reporters are chosen in `vitest.config.ts` by whether stdout is a terminal.
  Never read a run through `| tail` — a pipe shows nothing until the command
  exits, whatever the reporter.
- `tests/setup/resetProcessState.ts` clears the process-global state no test
  owns before every file and every test — the README's Testing section covers
  what is in it, what is deliberately not, and why plain
  `--sequence.shuffle` does not pass.
- The test database name is derived, never configured: `vitest.config.ts`
  appends this package directory's name and a sha256 of its absolute path to
  the `_test`-suffixed base in `.env.test`, and `globalSetup` creates it. That
  is what lets parallel worktrees run the suite at once — the opening
  `TRUNCATE` would otherwise wipe or block a suite running beside it. The
  readable half is `api` in every worktree, so two parallel runs differ only in
  the hash; `COMMENT ON DATABASE` records the checkout each belongs to. Never
  set `DB_DATABASE` to reach a specific database — the config and the workers
  assert the derived name. Two suites in the *same* checkout would still share
  one database, so `globalSetup` takes a Postgres advisory lock keyed to that
  name and the second run refuses to start. Run suites from separate worktrees
  to get them in parallel. `pnpm run test:db:prune` clears databases whose
  checkout is gone (add `--legacy` for unstamped leftovers).
- **Never run `prettier --write` or `eslint --fix` by hand.** The
  repository-root `.githooks/post-commit` runs each package's own fixers over
  the files that commit touched and amends the result in, and
  `.githooks/post-rewrite` covers a rebase. Two consequences: `format:check` is
  only meaningful on a *committed* tree — failing it on uncommitted edits means
  nothing has fixed them yet — and an import-order lint error mid-edit is the
  unfixed state rather than a decision waiting on you.
- Two files check the shared Redis path against a real server and skip without
  `REDIS_TEST_URL` in `.env.test` (`redis://127.0.0.1:6379/15`); CI has one and
  fails there rather than skipping. Never put `REDIS_URL` in `.env.test` —
  that puts the whole suite on one shared signup budget and it collapses into
  429s.
- `pnpm run check:all` is `type-check`, `lint`, `format:check`, `knip` plus
  `pnpm test`; api-ci then hands off to `pnpm -C cli run check:all`. Not
  `pnpm run format`: that is the fixer, and the bullet above says who owns it.
  `type-check` covers `src/`, `tests/`, `scripts/`, `vitest.config.ts` and
  `../cli/`; `pnpm run build` uses `tsconfig.build.json`, which is `src/` only.
  `cli/tsconfig.json` is a self-contained copy of these same options, so the
  two must be kept in step, and it carries one thing api's does not: a `paths`
  mapping sending `vitest` and `@hono/node-server` to `../api/node_modules`,
  because cli's tests are executed by this package's vitest and cli does not
  depend on either. In tests `res.json()` is deliberately `any` (`JsonBody` in
  `tests/setup/testContext.ts`): name the shape with `res.json<T>()` where it
  matters.
- **`../scripts/new-worktree.sh [--only <pkg>[,<pkg>]] <branch> [base-ref]`** —
  at the repository root, not this package's `scripts/`. It branches, adds the
  worktree under `~/.worktrees/<repo>/<branch>`, installs every package and
  copies the untracked `.env` files, which live at `api/.env` and
  `api/.env.test`. Make every worktree with it; a hand-made one fails the
  checks for reasons unrelated to the change in it — an uninstalled `cli/`
  fails only the CLI tests, deep into an api run. Do not symlink `node_modules`
  from the main checkout, and never put a worktree inside the repository.

# Health, and which build is running

`GET /health` and `GET /` share one handler and answer `status` plus the
`branch` and short `commit` that produced the running code.

The status half reaches the database, which is the point of a readiness probe.
Liveness is a TCP check rather than this one, so a database outage drains
replicas without restart-looping them.

The build half is `src/config/buildInfo.ts`. The deploy substitutes `{BRANCH}`
and `{COMMITHASH}` into `k8s/deployment.yaml`; there is no `.git` in the image.
Locally both are absent and it reads the checkout instead — two worktrees
serving two ports are indistinguishable until one says which branch it is.

# Deploys and migrations

Production deploys are rolling: the migration job runs first, then old and new
pods serve side by side. Every migration must therefore be backward-compatible
with the previous release (no dropping/renaming columns the running code still
reads; do that in a follow-up release).

**The same discipline extends past the database to the web client — see the
two-commit deploy rule in the root `AGENTS.md`.** An endpoint this package adds
must reach `main` in an earlier merge than the web code that calls it.

1. Add `src/db/migrations/<NNNN>_<name>.ts` exporting `up`/`down`.
2. `pnpm run migrate` and `pnpm run migrate:test`.
3. Regenerate committed types: `pnpm run kysely-codegen`. It takes no
   `DATABASE_URL` and never reads a database you develop against — it migrates
   a scratch database from `src/db/migrations`, introspects that, and drops it,
   so what lands in the commit is a function of the migrations rather than of
   your machine. The scratch database is named per checkout, so parallel
   worktrees can regenerate at once, and `pnpm run test:db:prune` reclaims one
   an interrupted run left behind. `kysely-codegen` is in knip's
   `ignoreDependencies` because the script spawns the binary rather than
   importing it.
   That writes `src/db/types.generated.ts`. `src/db/types.ts` is hand-written
   and is what the app imports: it re-exports the generated module and
   overrides `DB` to brand every `sort_key` column (convention 15). A new
   ordering scope needs its scope column added to `SCOPES` in
   `src/services/sortKey.ts`.
