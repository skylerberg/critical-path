# critical-path — `api/`

Backend for "Critical Path". Plain Postgres + Kysely — no Supabase, no Docker,
no OpenTelemetry.

This is one package of four in a monorepo. **Read the root `AGENTS.md`
first** — it owns the cross-package rules: the pnpm workspace trap, the pinned
toolchain, the two-commit deploy rule (which this package's changes are half
of), staying current with `main`, and the commit hooks. `README.md` here covers
running and testing the package; this file covers changing it.

**Where commands run.** A bare `pnpm run …` or `pnpm test` in this file is an
api-package command: run it from `api/`, or as `pnpm -C api run …` from the
repository root. Anything naming another package (`pnpm -C cli …`) is written
from the repository root; from inside `api/` those are `pnpm -C ../cli …`.

# The two clients

`web/` and `cli/` each generate their API client from this package's OpenAPI
spec: **a request/response schema change and both regenerated clients belong in
one commit** (`scripts/generate-clients.sh`, runnable from anywhere).
`codegen-ci.yaml` re-runs it and fails on a diff, so this is not optional.
Committing the clients beside the api change does not violate the two-commit
deploy rule — the generated files declare types and no runtime values; it is
the *call sites* that wait for the second merge.

Realtime and webhook event types come from a second document,
`realtime-events.json`, because `/ws` has no HTTP request or response to put in
the OpenAPI spec — see convention 14. Both documents are gitignored dumps that
every generator re-creates for itself from `api/src`, resolved by a fixed
in-repo path, so a missing `api/` is a fatal error rather than a quiet fallback
to the deployed API. `realtime-events.json` is additionally served at
`GET /api/realtime-events.json` so a client can generate against a deployed API
without a checkout.

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
    regenerated clients in the same commit.
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

The `/ws` protocol itself — handshake, ceilings, close codes, event envelopes —
is specified in the README's Realtime section and in `realtime-events.json`;
what follows is what only someone changing this package needs.

- The socket layer lives in `src/services/realtime/`. Two facts that bite:
  a handshake refused for too many sockets must be answered 429 **and then
  destroyed** (`end()` alone half-closes), and only one `auth` frame per socket
  is ever acted on, because frames from one read dispatch synchronously and two
  resolving together would double-register. Credential revocation publishes
  `sessions_revoked` on the bus, which closes sockets with code 4401; any new
  publisher must keep sending `user_id` — it is the dispatch fallback in
  `handleBusEntry`. Close codes added at a close site but not in
  `src/services/realtime/closeCodes.ts` reach no client, and the heartbeat
  interval crosses to clients as the literal type `RealtimeHeartbeatMs`, so
  raising it breaks their compile — both changes carry the same
  `scripts/generate-clients.sh` obligation a payload change does.
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
  pin land in one commit.
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

# Running things

- `pnpm run dev` — API on port 3001.
- **Run only the tests your change touches; let CI run the rest.** A single
  file or directory is
  `node --env-file=.env.test node_modules/vitest/vitest.mjs run <path>`, run from
  `api/`, and takes seconds. A CLI test file is reached the same way with the
  `../` prefix, because those files are collected by this package's vitest.
- `pnpm run test:changed` answers "which files is that" for you: it diffs
  against `origin/main` (pass another base as an argument), including
  uncommitted and untracked files, and runs every test that reaches one through
  the real module graph. `pnpm run test:related <paths>` is the same thing for
  paths you name yourself. Neither replaces the suite: a file nothing imports
  yet resolves to no tests, and a test that breaks through shared state rather
  than an import is invisible to both.
- The full `pnpm test` takes minutes and needs the machine mostly to itself:
  several e2e tests drive dozens of sequential requests inside one `it` against
  a 30s `testTimeout`, and a browser or benchmark running alongside fails them
  at exactly that timeout, which reads like a hang and is not one. Re-run a
  failure alone before believing it.
- Reporters are chosen in `vitest.config.ts` by whether stdout is a terminal.
  Never read a run through `| tail` — a pipe shows nothing until the command
  exits, whatever the reporter.
- The README's Testing section owns the test-database derivation, the process
  state reset and the Redis setup; the root `AGENTS.md` owns the commit hooks
  and why `format:check` only means anything on a committed tree.
- `pnpm run check:all` is `type-check`, `lint`, `format:check`, `knip` plus
  `pnpm test`; api-ci then hands off to `pnpm -C cli run check:all`.
  `type-check` covers `src/`, `tests/`, `scripts/`, `vitest.config.ts` and
  `../cli/`; `pnpm run build` uses `tsconfig.build.json`, which is `src/` only.
  `cli/tsconfig.json` is a self-contained copy of these same options, so the
  two must be kept in step, and it carries one thing api's does not: a `paths`
  mapping sending `vitest` and `@hono/node-server` to `../api/node_modules`,
  because cli's tests are executed by this package's vitest and cli does not
  depend on either. In tests `res.json()` is deliberately `any` (`JsonBody` in
  `tests/setup/testContext.ts`): name the shape with `res.json<T>()` where it
  matters.
- **`../scripts/new-worktree.sh <branch>`** — at the repository root, not this
  package's `scripts/` — creates a worktree with all four packages installed
  and the untracked `.env` files copied. Make every worktree with it; a
  hand-made one fails the checks for reasons unrelated to the change in it.

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
