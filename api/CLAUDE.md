# game-dev-api

Backend for "Critical Path" (rename via `src/config/constants.ts`). Plain
Postgres + Kysely — no Supabase, no Docker, no OpenTelemetry.

# Local data — do not destroy

The local `game_dev` Postgres database holds real, non-disposable data (the
owner's actual projects and tasks, e.g. the "Colori" board). Never run
destructive commands against it: no `DROP DATABASE` / `dropdb game_dev`, no
`TRUNCATE`, no bulk `DELETE`, and no `migrate:down` that drops a data-bearing
column. Only the test databases (`game_dev_test`, `game_dev_test_*`) may be
truncated or reset — the test suite does this by design. When clearing leftover
test accounts, scope the query narrowly (e.g. `email LIKE 'agent-%'`) and never
touch `gamedev@skylerberg.com` or its rows.

# Conventions

1. All POST/PUT/PATCH/DELETE handlers run inside a database transaction via
   `transactionMiddleware`. Route handlers access the connection with
   `c.get('db')` — never import `db` directly in route handlers. Opt out with
   the `skipAutoTransaction` marker middleware. Post-commit work (e.g. storage
   object deletion) goes through `c.get('postCommitHooks')`.
2. POST endpoints take a client-supplied `id` (enables optimistic UI).
   Duplicate id → 409. Map Postgres unique violations (code 23505, see
   `isUniqueViolation`) to 409 in handlers — pre-checks alone race.
3. Every route gets `describeRoute` with tags, summary, description,
   `security: [{ bearerAuth: [] }]` when authed, response schemas via
   `resolver(arkSchema)`, and error responses spread from `src/schemas/errors.ts`.
4. Request body validation via `jsonValidator(schema)` (strips undeclared
   keys, fails 422 with `{ error, details }`).
5. Re-export every schema module from `src/schemas/index.ts`; the OpenAPI
   schema-name registry reads that barrel.
6. Text length limits are enforced with arktype, not DB CHECK constraints.
   Non-empty CHECKs exist only where empty is never valid (names, title,
   email, color).
7. All FKs are `ON DELETE CASCADE`; don't manually delete rows the DB
   cascades.
8. Avoid N+1 queries; prefer one bulk query (`jsonArrayFrom` correlated
   subqueries) per screen-sized read.
9. Mutations with no useful body return `c.body(null, 204)`.
10. Comments: absolute minimum, only non-obvious why.
11. Project access is strict and centralized in `src/services/authorization.ts`:
    a project is visible to its creator and, when it has a `workspace_id`, to
    that workspace's members. Every project-scoped handler asserts access and
    answers 404 (never 403) for inaccessible rows.
12. Every mutation emits a realtime event via `publishAfterCommit` from
    `src/services/realtime` (runs as a post-commit hook, so nothing is
    published on rollback). Events about rows that are gone post-commit
    (`project_deleted`, `workspace_deleted`, `workspace_members_set`) must
    snapshot `recipientUserIds` inside the transaction; events about live rows
    rely on the delivery layer's per-event access re-check. Event catalog and
    envelope are in README.md.

# Realtime, email, and password reset

- WebSockets are served at `/ws` on the raw HTTP upgrade (see
  `src/services/realtime/transport.ts`); `/ws` is never part of the OpenAPI
  spec. Handshake: `{ type: 'auth', token }` within 10s, then
  `subscribe`/`unsubscribe` with a `project_id`; ping/pong heartbeat every 30s.
  Session revocation publishes `sessions_revoked` on the in-process bus, which
  closes that user's sockets with code 4401.
- Password-reset emails go through `src/services/email` (`EMAIL_DRIVER`:
  `console` default, `ses` loads the AWS SDK on first send). Reset tokens are
  stateless HMAC (`PASSWORD_RESET_SECRET`, required in production), 15-minute
  TTL, links built from `RESET_URL_BASE`. `POST /api/auth/forgot-password`
  always answers 204 and enqueues the send as a post-commit hook.

# Running things

- `npm run dev` — API on port 3001.
- `npm test` — full suite (loads `.env.test`, migrates + truncates
  `game_dev_test`). Single file:
  `node --env-file=.env.test node_modules/vitest/vitest.mjs run <path>`.
- `npm run type-check`, `npm run lint`, `npm run format`.

# Migration workflow

1. Add `src/db/migrations/NNNN_name.ts` exporting `up`/`down`.
2. `npm run migrate` and `npm run migrate:test`.
3. Regenerate committed types:
   `DATABASE_URL=postgres://skylerberg@127.0.0.1:5432/game_dev npm run kysely-codegen`.
