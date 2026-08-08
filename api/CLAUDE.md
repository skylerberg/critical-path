# critical-path-api

Backend for "Critical Path". Plain
Postgres + Kysely — no Supabase, no Docker, no OpenTelemetry.

# Companion repository

`../critical-path-web` is the Svelte 5 frontend for this API. Run the API
first (`npm run dev`, port 3001), then the web app (`npm run dev` in
`../critical-path-web`, port 5173) — Vite proxies `/api` and `/ws` to
`localhost:3001`.

Both the web app and the `cli/` package generate their API client from this
repo's OpenAPI spec. A change to any request/response schema must regenerate
the committed clients and commit them together: `npm run --prefix cli
generate-api` here and `npm run generate:api` in `../critical-path-web`.
Neither needs `npm run openapi:dump` first — both generators re-dump before
reading, because the dump is a pure function of `src/` (no database, under two
seconds) and producing one is cheaper than reasoning about whether the old one
is stale. See `../critical-path-web/CLAUDE.md` for the frontend's
conventions.

Realtime and webhook event types come from a second document,
`realtime-events.json`, because `/ws` has no HTTP request or response to put in
the OpenAPI spec — see convention 14. It is dumped locally and gitignored, the
same as `openapi.json`, and served at `GET /api/realtime-events.json` so a client
can generate against a deployed API without a checkout of this repo. Both the
web app and the CLI generate from it.

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
   mount prefix, and `/api/auth`, `/api/images` and `/api/attachments` each host
   public and authenticated routes together. Those three files export a second
   `PublicHono` router for their public half, because one Hono instance carries
   one context type: handlers on an `AppHono` get `AppContext`, where
   `c.get('user')` is a user; handlers on a `PublicHono` get `PublicContext`,
   where it is `AuthenticatedUser | undefined`. A service that never reads the
   user takes `Pick<PublicContext, 'get'>` so either kind of route can call it;
   one that does read it takes `Pick<AppContext, 'get'>`, which is what stops a
   public route from reaching it.
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
    row, always an editor) and to its `project_member` rows, each of which
    carries a `role` of `editor` or `viewer`. **404 for a caller with no
    access; 403 only for a caller who can already read the row.** Every
    project-scoped read asserts access (`assertProjectAccess` /
    `assertTaskAccess`); every project-scoped mutation asserts write
    (`assertProjectWrite` / `assertTaskWrite`), which is the same 404 plus a
    403 for a viewer. A new mutating route that asserts only access is a
    defect. Three categories are the deliberate exceptions, and all assert
    access rather than write: comments, because viewers may post, edit and
    delete their own; a row keyed to the calling user and observable by
    nobody else (`project_user_position`, `project_user_seen`), because a
    viewer who could never set their own is a bug, not a safety property;
    and `PUT /api/projects/:id/members`, which asserts access and then gates
    on the caller's role itself, because a viewer may use it to remove
    themselves and nothing else. Roles are normalized fail-closed — anything
    that is not exactly `editor` reads as `viewer`. A `task_dependency` edge is
    the one thing that spans two projects: creating one asserts write on the
    blocked side and **read** on the blocker's, and removing one asserts write
    on the blocked side alone, so an edge whose far end became unreadable stays
    detachable. Anything that reads the far side of such an edge either filters
    on access and reports a bare count for what it dropped, or reports nothing
    at all — see `src/services/crossProjectBlockers.ts` and the
    cross-project-dependencies section of the README.
13. Every mutation emits a realtime event via `publishAfterCommit` from
    `src/services/realtime` (runs as a post-commit hook, so nothing is
    published on rollback). Events about rows or access that are gone
    post-commit (`project_deleted`, membership-removal evictions) must
    snapshot `recipientUserIds` inside the transaction; events about live rows
    rely on the delivery layer's per-event access re-check. Every fact about a
    type — that it exists, whether it reaches webhook registrations, whether it
    raises the unseen-changes dot, whether its payload names the acting user
    (`carriesActor`), and whether it carries a project — is one row of the table
    in `src/services/realtime/eventCatalog.ts`. Adding a type there is what makes
    it publishable, so the classification cannot be left half-done, and a unit
    test holds the README table to the same set.
14. A type's **payload shape** is one row of a second table,
    `src/services/realtime/payloads.ts`, and the two tables are pinned to each
    other: a type in the catalog with no payload row does not compile.
    `publishAfterCommit` and `publish` are generic over the event type, so a
    payload that disagrees with its row is a type error at the publish site
    rather than a README row that drifts. Reuse the request/response schema the
    payload actually is (`boardTaskSchema`, `columnSchema`, …) instead of
    restating its fields, and never re-export this module from
    `src/schemas/index.ts`: the OpenAPI schema-name registry throws on two
    schemas with identical JSON Schema, which the bare `{ id }` payloads are.
    `actor_user_id` is merged in from the catalog rather than restated on the
    twenty-eight rows that carry it, and it is required, which is what forces the
    two publishers outside a request — the series sweep and the unfurl job — to
    name someone. `publishAfterCommit` therefore takes `CallerPayload<T>`, the
    payload minus the field it fills in from the session; `publish` still takes
    the whole thing.
    After changing a payload run `npm run realtime:dump` and
    `npm run --prefix cli generate-realtime`, and commit the regenerated
    `cli/src/api/realtime.generated.ts`. The dump itself is gitignored like
    `openapi.json`; what the clients check is that theirs is not older than this
    repo's HEAD.
15. Every `sort_key` is unique within its scope, and the `task` index spans
    archived rows on purpose, so a key a client computed — ranked against only
    the rows that client can see — is a request, not a value to store. The
    column type is `ResolvedSortKey`, a branded string defined in
    `src/db/types.ts`, and the request schemas produce a plain `string`: the
    only way across is `resolveSortKey`, `resolveSortKeys` (a run of keys
    resolved against each other as well as the scope, for a batch insert) or
    `appendKeys`. Writing a client's key straight into the row is what used to
    answer 500 on the rows it could not see; it is now a type error at the
    write site rather than a rule each new handler has to remember. Keep the
    residual `isUniqueViolation` → 409 anyway: resolving reads the scope, and
    nothing holds it until the write. Raw `sql` writes bypass the brand — the
    bulk paths that use them take the column's tail advisory lock instead, and
    a new one must do the same, in that order (tail lock, then task rows) or it
    deadlocks against the bulk move.
16. Background work is pinned the same way realtime events are, across three
    tables. `src/services/jobs/payloads.ts` declares which kinds exist and the
    shape of each payload; `registerJobHandler` and `enqueueJob` are generic over
    its keys, so a kind with no row cannot be registered or enqueued and a
    payload that disagrees with its row is a type error at the enqueue site
    rather than a re-parse inside the handler. `src/services/jobs/register.ts` is
    a `Record<JobKind, () => void>` against the same keys, so a kind that nothing
    runs does not compile, and it is called **once**, from the entrypoint beside
    the worker — never as an import side effect. `registeredJobKinds()` is both
    what `claimDueJobs` filters on and what `syncPeriodicJobs` retires schedules
    by, so a process holding a different subset than production leaves work
    unclaimed and deletes schedules it should not; registering on import gave
    tests exactly that. Payloads carry ids and never contact details
    (`assertJobPayload`).
17. A route's response statuses are declared once, in the object built from
    `src/schemas/responses.ts` (`jsonResponse` / `emptyResponse` /
    `rawResponse`), and that same object is both spread into `describeRoute`'s
    `responses` and read back as the handler's return type through
    `Returned<typeof …>`. hono-openapi validates nothing at runtime, so without
    the pairing a handler can quietly stop answering what its own spec promises —
    which is how `GET /api/tasks/:id` came to declare a required `images[]` it
    had never sent. Error bodies stay out of it deliberately: they come from
    thrown `AppError`s through `onError`, never from a handler return, so they
    remain ordinary spreads from `src/schemas/errors.ts`.

# Realtime, email, and password reset

- WebSockets are served at `/ws` on the raw HTTP upgrade (see
  `src/services/realtime/transport.ts`); `/ws` is never part of the OpenAPI
  spec. Handshake: `{ type: 'auth', token }` within 10s, then
  `subscribe`/`unsubscribe` with a `project_id`; ping/pong heartbeat every 30s.
  The handshake token is either a session token or a personal access token.
  Credential revocation publishes `sessions_revoked` on the realtime bus, which
  closes sockets with code 4401: a payload of `{ user_id }` closes that user's
  session sockets; one that also carries `personal_access_token_id` closes only
  the sockets authenticated with that token; and one that carries `session_id`
  closes only that session's. Any new publisher must keep sending `user_id` —
  it is the dispatch fallback in `handleBusEntry`.
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
  `APP_URL_BASE`, never in the service that sends it: the paths are pinned there
  and again in the web app's `src/lib/router.test.ts`, which is what keeps a
  route rename from quietly turning mail into a not-found page. `POST
  /api/auth/forgot-password` answers 204 and enqueues the send as a post-commit
  hook for an address that has an account, 404 for one that does not, and 429
  past either reset budget. It is deliberately informative: signup already
  answers 409 for an address in use, unauthenticated, so a non-revealing
  forgot-password bought nothing and cost every mistyped address a silent wait.
- Every mailed-link token — password reset, email verification, unsubscribe —
  is one codec, `src/services/signedToken.ts`
  (`base64url(claims).base64url(hmac)`). The families share a secret
  (`EMAIL_TOKEN_SECRET` falls back to `PASSWORD_RESET_SECRET`), so separating
  them is what stops one family's token being spent as another's: the type is a
  required argument to both `encodeSignedToken` and `decodeSignedToken`, not a
  claim each caller remembers to check, and it is reserved from the claims
  object at the type level. A new family is a new type string, and a token
  naming no type at all verifies for nobody.
- Neither `change-password` nor `reset-password` revokes anything: both answer
  204 and leave every session and token signed in, so a change-password issues
  no replacement token. Sessions are revoked only from the sessions list
  (`DELETE /api/auth/sessions/:id`). Both flows do rotate
  `app_user.alternative_id`, which is the reset-token HMAC subject — that is
  what makes a reset link single-use, and it has nothing to do with sessions.

# CLI

`cli/` is a standalone nested npm package (`critical-path-cli`, command
`cpath`) — a full CLI client for this API. It deliberately keeps its own
package-lock and node_modules (`npm ci --prefix cli`) so the deployed image
and the deploy workflow's path filters are untouched by CLI changes; never
add CLI dependencies to the root package.json. CLI tests are part of the root
`npm test` (they drive the Hono app in-process via `cli/tests/e2e/helpers.ts`);
CLI checks run from `cli/`: `npm run type-check && npm run lint && npm run
format:check`. Knip is the exception that covers both from the root, because
`cli` is a knip workspace in knip.json — that is what resolves CLI imports
against `cli/package.json` instead of the root's, and it is unrelated to npm
workspaces, which this repo still must not use. After changing the API
surface, run `npm run --prefix cli generate-api` and commit the regenerated
`cli/src/api/api.generated.ts`; after changing a realtime payload, run
`npm run --prefix cli generate-realtime` and commit
`cli/src/api/realtime.generated.ts` alongside it. Both re-dump first, so
`openapi:dump` and `realtime:dump` are only needed to refresh the dumps for
something else.

# Staying current with main

`main` moves fast — several PRs an hour when more than one agent is working — so a
branch cut an hour ago is routinely behind, and *nothing tells you* until a rebase
conflicts or CI fails on a rule your base predates. Rebase onto `main` (not merge:
branches are rebased, only the PR itself lands as a merge commit) and check at
three points:

```sh
git fetch origin && git rev-list --count HEAD..origin/main   # 0 means current
```

1. **Before starting.** A stale base means writing against code that has moved,
   and it is also where duplicated work comes from: run `gh pr list` and
   `git branch -a` too, because the fix you are about to write may already be
   open. That has happened.
2. **Before the full suite.** A 4-minute run against a stale base proves nothing
   about the merge, and re-running after the rebase costs the same 4 minutes
   twice.
3. **Before pushing, and again before merging.** `gh pr view <n> --json
   mergeStateStatus` reports `CLEAN` only for a branch that still applies.

After any rebase, re-run the checks rather than trusting the pre-rebase pass, and
re-run whatever generation the change involves (the client generators, which
re-dump for themselves) — a rebase can bring in a schema change that silently
invalidates a committed generated file.

One conflict is worth calling out because it resolves wrongly by default: a branch
cut before `openapi.json` or `realtime-events.json` was untracked still carries the
tracked copy, so merging main raises a modify/delete conflict on it. Keep the
deletion — the file is a dump now. Taking "modified" instead, which is the side
git's hint nudges you toward, silently puts a 140KB generated file back under
version control, and `tests/unit/generatedDocuments.test.ts` is what fails when it
does.

Two ways a stale base has produced *wrong* conclusions here, both worth guarding
against directly:

- **Comments about build configuration go stale.** `tsc` covers `src`, `tests`,
  `scripts` and `vitest.config.ts`; a comment claiming tests are unchecked was
  true when written and false a release later. Read `package.json` and
  `tsconfig.json` rather than a comment describing them.
- **"No diff" is not a passing check.** `git diff --quiet <file>` is vacuously
  clean for a gitignored file, and for one a failed command never wrote —
  `openapi.json` and `realtime-events.json` are both gitignored. Assert the
  positive: the command exited 0, the file was written, the content is what you
  expected.

# Running things

- `npm run dev` — API on port 3001.
- **Run only the tests your change touches; let CI run the rest.** A single
  file or directory is
  `node --env-file=.env.test node_modules/vitest/vitest.mjs run <path>` and
  takes seconds. The full `npm test` is ~3 minutes, and running it after every
  edit is most of the wall-clock in a long session for almost no extra signal —
  CI runs it on every push, sharded. Reach for the full suite once, before
  opening the PR, and when a change is broad enough that you cannot name the
  files it affects (a shared helper, middleware, a schema everything imports).
- `npm test` — full suite (loads `.env.test`, migrates + truncates).
- `tests/setup/resetProcessState.ts` clears the process-global state no test
  owns — the rate limiter's windows and the job runner's in-flight count —
  before every file and every test. The realtime socket registry, the bus
  subscribers and the job handler registry are deliberately not in it: several
  files set those up once per file in `beforeAll`, so clearing them per test
  would break those files rather than isolate them, and they stay each file's
  own responsibility. That is also why `--sequence.shuffle.files` passes and
  plain `--sequence.shuffle` does not.
- The test database name is derived, never configured: `vitest.config.ts`
  appends this checkout's directory name and a hash of its path to the
  `_test`-suffixed base in `.env.test`, and `globalSetup` creates it. That is
  what lets agents in parallel worktrees run the suite at once — the opening
  `TRUNCATE` would otherwise wipe or block a suite running beside it. Never set
  `DB_DATABASE` to reach a specific database; both the config and the workers
  assert the derived name and fail loudly. Two suites in the *same* checkout
  would still share one database, so `globalSetup` takes a Postgres advisory
  lock keyed to that name before it truncates and the second run refuses to
  start: a `TRUNCATE` landing under a live run deletes rows it has already
  created, which surfaces as one unrelated test failing on a wrong exit code
  and passing on the rerun. Run suites from separate worktrees to get them in
  parallel. `npm run test:db:prune` clears databases whose checkout is gone
  (add `-- --legacy` for unstamped leftovers).
- Two files check the shared Redis path against a real server and skip without
  `REDIS_TEST_URL` in `.env.test` (`redis://127.0.0.1:6379/15`, `brew install
  redis`); CI has one and fails there rather than skipping. Never put
  `REDIS_URL` in `.env.test` — that puts the whole suite on one shared signup
  budget and it collapses into 429s.
- `npm run type-check`, `npm run lint`, `npm run format`. `type-check` covers
  `src/`, `tests/`, `scripts/`, `vitest.config.ts` and `cli/` — the root
  `tsconfig.json` is the check-everything project and emits nothing; `npm run
  build` uses `tsconfig.build.json`, which is `src/` only. `cli/` is in that
  project despite being a separate npm package, so an editor resolves its files
  against real options; left out, every file under `cli/` falls back to an
  inferred project and reads as a wall of "cannot find module" that has nothing
  to do with the code. In tests
  `res.json()` is deliberately `any` (`JsonBody` in
  `tests/setup/testContext.ts`): a parsed body has no compile-time link to the
  route that produced it, so name the shape with `res.json<T>()` where it
  matters rather than trying to type the client.
- `scripts/new-worktree.sh <branch> [base-ref]` creates a worktree that can run
  all of the above: it branches, adds the worktree under
  `~/.worktrees/<repo>/<branch>`, symlinks `node_modules` and `cli/node_modules`
  from the main checkout by absolute path, and copies the untracked `.env` and
  `.env.test`. A worktree made by hand and missing any of those fails the checks
  for reasons that have nothing to do with the change in it — a missing
  `cli/node_modules` in particular fails only the CLI tests, deep into a run.
  The script resolves everything from the checkout it is run in, so it works
  from a sibling project too.
- A worktree that already exists but predates the script needs `node_modules`
  symlinked from the main checkout
  (`ln -s /absolute/path/to/repo/node_modules node_modules`) rather than a
  second `npm install`. Never put one inside the repository: it is a second full
  copy of the codebase that every recursive search has to walk.

# Migration workflow

Production deploys are rolling: the migration job runs first, then old and
new pods serve side by side. Every migration must therefore be
backward-compatible with the previous release (no dropping/renaming columns
the running code still reads; do that in a follow-up release).

1. Add `src/db/migrations/NNNN_name.ts` exporting `up`/`down`.
2. `npm run migrate` and `npm run migrate:test`.
3. Regenerate committed types: `npm run kysely-codegen`. It takes no
   `DATABASE_URL` and never reads a database you develop against — it migrates
   a scratch database from `src/db/migrations`, introspects that, formats the
   output, and drops it, so what lands in the commit is a function of the
   migrations rather than of your machine. Introspecting `game_dev` instead is
   how a column left behind by an abandoned branch gets committed looking
   exactly like a real one. The scratch database is named per checkout, so
   parallel worktrees can regenerate at once, and it carries the same checkout
   stamp the test databases do, so `npm run test:db:prune` reclaims one an
   interrupted run left behind. `kysely-codegen` is in knip's
   `ignoreDependencies` because that script spawns the binary rather than
   importing it, which is not a reference knip can see.
   That writes `src/db/types.generated.ts`. `src/db/types.ts` is hand-written
   and is what the app imports: it re-exports the generated module and
   overrides `DB` to brand every `sort_key` column (convention 15). A new
   ordering scope needs its scope column added to `SCOPES` in
   `src/services/sortKey.ts`; the brand follows from the column name.
