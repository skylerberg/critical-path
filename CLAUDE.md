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
the committed clients and commit them together: `npm run openapi:dump` here,
then `npm run generate:api` in `../critical-path-web` and
`npm run --prefix cli generate-api` here. See `../critical-path-web/CLAUDE.md`
for the frontend's conventions.

# Conventions

1. All POST/PUT/PATCH/DELETE handlers run inside a database transaction via
   `transactionMiddleware`. Route handlers access the connection with
   `c.get('db')` — never import `db` directly in route handlers. Opt out with
   the `skipAutoTransaction` marker middleware. Post-commit work (e.g. storage
   object deletion) goes through `c.get('postCommitHooks')`.
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
    that is not exactly `editor` reads as `viewer`.
13. Every mutation emits a realtime event via `publishAfterCommit` from
    `src/services/realtime` (runs as a post-commit hook, so nothing is
    published on rollback). Events about rows or access that are gone
    post-commit (`project_deleted`, membership-removal evictions) must
    snapshot `recipientUserIds` inside the transaction; events about live rows
    rely on the delivery layer's per-event access re-check. Payload shapes are
    in README.md; every other fact about a type — that it exists, whether it
    reaches webhook registrations, whether it raises the unseen-changes dot,
    and whether it carries a project — is one row of the table in
    `src/services/realtime/eventCatalog.ts`. Adding a type there is what makes
    it publishable, so the classification cannot be left half-done, and a
    unit test holds the README table to the same set.

# Realtime, email, and password reset

- WebSockets are served at `/ws` on the raw HTTP upgrade (see
  `src/services/realtime/transport.ts`); `/ws` is never part of the OpenAPI
  spec. Handshake: `{ type: 'auth', token }` within 10s, then
  `subscribe`/`unsubscribe` with a `project_id`; ping/pong heartbeat every 30s.
  The handshake token is either a session token or a personal access token.
  Credential revocation publishes `sessions_revoked` on the realtime bus, which
  closes sockets with code 4401: a payload of `{ user_id }` closes that user's
  session sockets; one that also carries `personal_access_token_id` closes only
  the sockets authenticated with that token; one that carries `session_id`
  closes only that session's; and one that carries `except_session_id` closes
  the user's session sockets apart from that one, which is how a password
  change keeps the replacement session it just issued. Any new publisher must
  keep sending `user_id` — it is the dispatch fallback in `handleBusEntry`.
- The realtime bus is in-process by default; when `REDIS_URL` is set (as in
  production, which runs 2+ replicas) publishes fan out via Redis pub/sub so
  every replica delivers to its own sockets. Rate limits also share Redis
  counters then, falling back to per-process windows if Redis is unreachable.
- Password-reset emails go through `src/services/email` (`EMAIL_DRIVER`:
  `console` default, `ses` loads the AWS SDK on first send). Reset tokens are
  stateless HMAC (`PASSWORD_RESET_SECRET`, required in production), 15-minute
  TTL. Every link the server mails is built in `src/services/webLinks.ts` from
  `APP_URL_BASE`, never in the service that sends it: the paths are pinned there
  and again in the web app's `src/lib/router.test.ts`, which is what keeps a
  route rename from quietly turning mail into a not-found page. `POST
  /api/auth/forgot-password` always answers 204 and enqueues the send as a
  post-commit hook.

# CLI

`cli/` is a standalone nested npm package (`critical-path-cli`, command
`cpath`) — a full CLI client for this API. It deliberately keeps its own
package-lock and node_modules (`npm ci --prefix cli`) so the deployed image
and the deploy workflow's path filters are untouched by CLI changes; never
add CLI dependencies to the root package.json. CLI tests are part of the root
`npm test` (they drive the Hono app in-process via `cli/tests/e2e/helpers.ts`);
CLI checks run from `cli/`: `npm run type-check && npm run lint && npm run
format:check`. After changing the API surface, run `npm run openapi:dump &&
npm run --prefix cli generate-api` and commit the regenerated
`cli/src/api/api.generated.ts`.

# Running things

- `npm run dev` — API on port 3001.
- `npm test` — full suite (loads `.env.test`, migrates + truncates). Single
  file: `node --env-file=.env.test node_modules/vitest/vitest.mjs run <path>`.
- The test database name is derived, never configured: `vitest.config.ts`
  appends this checkout's directory name and a hash of its path to the
  `_test`-suffixed base in `.env.test`, and `globalSetup` creates it. That is
  what lets agents in parallel worktrees run the suite at once — the opening
  `TRUNCATE` would otherwise wipe or block a suite running beside it. Never set
  `DB_DATABASE` to reach a specific database; both the config and the workers
  assert the derived name and fail loudly. Two suites in the *same* checkout
  still share one database, so run them from separate worktrees.
  `npm run test:db:prune` clears databases whose checkout is gone (add
  `-- --legacy` for unstamped leftovers).
- Two files check the shared Redis path against a real server and skip without
  `REDIS_TEST_URL` in `.env.test` (`redis://127.0.0.1:6379/15`, `brew install
  redis`); CI has one and fails there rather than skipping. Never put
  `REDIS_URL` in `.env.test` — that puts the whole suite on one shared signup
  budget and it collapses into 429s.
- `npm run type-check`, `npm run lint`, `npm run format`.
- Worktrees under `.pi/worktrees/` need `node_modules` to run any of the
  above; symlink it from the main checkout
  (`ln -s ../../../node_modules node_modules` from inside the worktree)
  instead of running `npm install` again.

# Migration workflow

Production deploys are rolling: the migration job runs first, then old and
new pods serve side by side. Every migration must therefore be
backward-compatible with the previous release (no dropping/renaming columns
the running code still reads; do that in a follow-up release).

1. Add `src/db/migrations/NNNN_name.ts` exporting `up`/`down`.
2. `npm run migrate` and `npm run migrate:test`.
3. Regenerate committed types:
   `DATABASE_URL=postgres://skylerberg@127.0.0.1:5432/game_dev npm run kysely-codegen`.
