# game-dev-api

Backend for "Critical Path" (rename via `src/config/constants.ts`). Plain
Postgres + Kysely — no Supabase, no Docker, no OpenTelemetry.

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
