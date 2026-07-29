---
name: add-api-endpoint
description: Add a new HTTP route/handler to the Critical Path API (Hono). Use when adding or changing a POST/PUT/PATCH/DELETE/GET endpoint under src/routes. Enforces the project's 12 conventions: transaction middleware, client-supplied ids, describeRoute/OpenAPI, arktype validation, centralized authorization, and realtime publish.
---

# Add an API endpoint

Every route in this API follows a fixed set of invariants. Follow them in
order; missing one is a defect, not a style choice. The canonical examples
are in `src/routes/tasks.ts` and `src/routes/projects.ts`.

## 1. Register the router

In `src/index.ts`, `app.route('/api/<prefix>', <router>))`. Upload routes that
need a larger body get a **second** `app.route` on the same prefix so a
route-level `bodyLimit` runs before the global cap (see `imageUploadRouter`,
`avatarUploadRouter`).

## 2. Transaction

POST/PUT/PATCH/DELETE handlers run inside `transactionMiddleware` (already
applied globally). Read and write through `c.get('db')` — **never** import
`db` directly in a handler. Opt out only with the `skipAutoTransaction` marker
middleware. Post-commit work (e.g. deleting storage objects) goes through
`c.get('postCommitHooks')`, so it does not run on rollback.

## 3. Client-supplied id (POST)

POST bodies take a client-generated `id` (enables optimistic UI). A duplicate
id → **409**. Do not pre-check for existence to avoid the race; attempt the
insert and map a Postgres unique violation (code `23505`, use
`isUniqueViolation` from `src/utils/errors.ts`) to 409.

## 4. Validation

Validate the body with `jsonValidator(schema)` (`src/middleware/jsonValidator.ts`);
it strips undeclared keys and returns 422 `{ error, details }` on failure.
Validate path/query params with `paramValidator`. Schemas are arktype
(`src/schemas/*.ts`); text length limits live in arktype, **not** in DB CHECK
constraints. If you add a new schema module, re-export it from
`src/schemas/index.ts` — the OpenAPI schema-name registry reads that barrel.

## 5. describeRoute / OpenAPI

Every route gets `describeRoute` with: `tags`, `summary`, `description`,
`security: [{ bearerAuth: [] }]` when authed, response schemas via
`resolver(arkSchema)`, and error responses spread from
`src/schemas/errors.ts` (`unauthorizedErrorResponse`, `forbiddenErrorResponse`,
`notFoundErrorResponse`, `conflictErrorResponse`, `validationErrorResponse`,
…). Use `authMiddleware` for authed routes.

## 6. Authorization (the subtle one)

Project access is centralized in `src/services/authorization.ts`. Roles
normalize fail-closed: anything not exactly `editor` reads as `viewer`.

- **Reads** assert access: `assertProjectAccess` / `assertTaskAccess`.
- **Mutations** assert write: `assertProjectWrite` / `assertTaskWrite`.

**404 for a caller with no access; 403 only for a caller who can already read
the row** (a viewer attempting a mutation). A new mutating route that asserts
only access is a defect. The owner-only 403s are `PUT /api/projects/:id/owner`
and `DELETE /api/projects/:id`. Comments are the deliberate exception: viewers
may post/edit/delete their own, so comment handlers assert **access**, not
write.

## 7. Queries

Avoid N+1. Prefer one bulk query per screen-sized read, using correlated
`jsonArrayFrom` subqueries (see `src/services/boardPayload.ts`).

## 8. Realtime

Every mutation publishes an event via `publishAfterCommit` from
`src/services/realtime` (runs as a post-commit hook, so nothing is published on
rollback). Snapshot `recipientUserIds` inside the transaction for events about
rows/access that are gone post-commit (`project_deleted`, membership evictions);
events about live rows rely on the delivery layer's per-event access re-check.
The event catalog and envelope are in `README.md`.

## 9. Response shape

Mutations with no useful body return `c.body(null, 204)`. Otherwise return the
documented shape (e.g. the board task shape from `fetchBoardTaskRows`).

## 10. After the code

Regenerate the OpenAPI clients if any request/response shape changed — see the
`change-api-schema` skill. Then run the `run-checks` skill.
