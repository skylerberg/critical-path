# Critical Path — api

TypeScript API for **Critical Path**, a project-management suite (Hono + Kysely + Postgres).

This is the `api/` package of the Critical Path monorepo: `web/` is the
frontend, `cli/` is the `cpath` command-line client, and `preview-edge/` serves
PR previews. Each package installs on its own; there is no pnpm workspace.
Commands below run from this directory unless they name another package, and
the root `AGENTS.md` covers what is true across all four.

The OpenAPI spec documents every route's shape — see Development below. The
Behavior section covers what the spec cannot: the rules that span routes.

## Requirements

- Node.js >= 22
- PostgreSQL 18 running locally on `127.0.0.1:5432` (no Docker, no Supabase)

## Setup

```sh
createdb critical_path
createdb critical_path_test

cd api
cp .env.example .env        # defaults expect role `skylerberg`, no password
pnpm install                 # also activates the repository's .githooks hooks

pnpm run migrate             # migrate the dev database
pnpm run migrate:test        # migrate the test database
```

Create `api/.env.test` for the test suite — both env files live in this
package, not at the top of the checkout:

```
DB_USER=skylerberg
DB_DATABASE=critical_path_test
STORAGE_DISK_ROOT=./data/test-uploads
ENVIRONMENT=test
```

`DB_DATABASE` here is the _base_ name: each checkout derives its own test
database from it, so parallel worktrees never share one. See
[Testing](#testing). For a worktree, `scripts/new-worktree.sh <branch>` at the
repository root does the installs and copies both env files across.

## Development

```sh
pnpm run dev                 # watch mode on http://localhost:3001
pnpm start                   # run once
```

Swagger UI is at `http://localhost:3001/api/docs`, the spec at
`/api/openapi.json`, and `pnpm run openapi:dump` writes the spec to
`./openapi.json` without starting a server. The page serves Swagger UI's own
bundle out of the image rather than from a CDN: the SPA keeps its session token
in this origin's `localStorage`, so a third-party script tag on the docs page
would be a third party holding every reader's credentials.

**Proxies.** Clients are identified by socket address, by one derivation
(`src/services/clientIp.ts`) shared by the rate limiters and the realtime
socket ceiling. Behind a reverse proxy that appends the client IP to
`X-Forwarded-For`, set `TRUST_PROXY=true`; leave it unset otherwise, since the
header is client-forgeable. `TRUST_PROXY_HOPS` is how many entries the proxies
append, counted from the right (production: `2`, because a GCP load balancer
appends `<client-ip>, <lb-ip>`). Too low reads a forged entry as the client;
too high falls back to the socket address, which behind a load balancer is one
bucket for the whole internet.

## Testing

```sh
pnpm test                    # full suite against this checkout's own database
pnpm run test:watch
pnpm run test:coverage
pnpm run test:db:prune       # drop test databases whose checkout is gone
```

The suite loads `.env.test`, migrates the test DB in global setup, and
truncates all tables at suite start — never point it at a database with data
you care about. `api/AGENTS.md` covers how to run just the tests a change
touches.

**The test database name is derived, not configured.** `vitest.config.ts` takes
`DB_DATABASE` from `.env.test` as a base — it must end in `_test` — and appends
this package directory's name and a sha256 of its absolute path, giving e.g.
`critical_path_test_api_3f2a1b9c`. `globalSetup` creates the database on first
use (so the role needs `CREATEDB`) and stamps it with `COMMENT ON DATABASE`
naming the checkout it belongs to; the readable half is `api` in every
worktree, so the stamp is how you tell two of them apart. This exists because
the opening `TRUNCATE` is fatal to a suite running beside it. Two suites in the
_same_ checkout still share one database — `globalSetup` takes an advisory lock
and the second run refuses to start — so run them from separate worktrees.
`TEST_DB_NAME` overrides the derivation entirely, `DB_MAINTENANCE_DATABASE`
(default `postgres`) sets where `CREATE DATABASE` is issued, and `DB_POOL_MAX`
(default 10, and 5 under vitest) keeps concurrent suites inside
`max_connections`.

`tests/setup/resetProcessState.ts` clears the process-global state no test owns
— the rate limiter's windows and the job runner's in-flight count — before
every file and every test. The realtime socket registry, the bus subscribers
and the job handler registry are deliberately left out: several files set those
up once per file in `beforeAll`, so clearing them per test would break those
files rather than isolate them. That is why `--sequence.shuffle.files` passes
and plain `--sequence.shuffle` does not.

**Real Redis.** Two test files drive the shipped Lua and pub/sub against a real
Redis, because the shared path silently falls back to per-process state when
anything about it is wrong. They need `REDIS_TEST_URL` in `.env.test`; without
it they skip with a notice — except on CI, where a run that cannot reach a
Redis fails:

```sh
brew install redis && brew services start redis
echo 'REDIS_TEST_URL=redis://127.0.0.1:6379/15' >> .env.test
```

It must be loopback; anything else is refused, because the pub/sub channel has
one name on every server and a misaimed URL would deliver fabricated events to
live sockets. `REDIS_URL` is deliberately a different variable — setting it
would put every test file on one shared signup budget and the run would
collapse into 429s.

## Checks

```sh
pnpm run check:all          # the four below, then `pnpm test`
pnpm run type-check
pnpm run lint
pnpm run format:check
pnpm run knip
pnpm -C ../cli run check:all
```

`format:check`, not `format`: the latter is `prettier --write`, and the fixers
belong to the commit hook the root `AGENTS.md` describes. That is also why this
one only means anything once the tree is committed.

## Database workflow

Migrations live in `src/db/migrations/` (Kysely `Migrator`, numbered
`<NNNN>_<name>.ts` files exporting `up`/`down`):

```sh
pnpm run migrate             # dev DB to latest
pnpm run migrate:down        # dev DB one step down
pnpm run migrate:test        # test DB to latest
```

After changing the schema, regenerate the committed types with
`pnpm run kysely-codegen`. It takes no argument, and in particular no
`DATABASE_URL`: it migrates a scratch database from `src/db/migrations`,
introspects that one and drops it, so the output is a function of the
migrations rather than of any database you develop against. It writes
`src/db/types.generated.ts`; `src/db/types.ts` is hand-written, imports that
one and is what the app imports.

## Benchmarks

`bench/` seeds a large instance into a database of its own, drives the app
in-process and reports p50/p95, statement counts, time spent in Postgres and
payload size per endpoint (`pnpm run bench`, `bench:heavy`,
`bench --explain`). It runs on demand — never in CI, never in `pnpm test`.
`bench/README.md` covers the tiers and how to add a scenario;
`docs/scaling.md` records the current scaling posture.

## Regenerating the two clients

`web/` and `cli/` each carry a committed client built from this package's
OpenAPI and realtime documents. `scripts/generate-clients.sh` (repository root,
runnable from anywhere) rebuilds all four files; run it after any schema or
realtime-payload change and commit its output with the change.
`codegen-ci.yaml` fails a pull request whose committed clients differ.

## CLI (`cpath`)

`cli/` builds `cpath`, a command-line client covering this API's whole surface,
`/ws` included; `cli/README.md` is its command reference. The thing that
surprises people working here: the CLI's tests are collected by
`vitest.config.ts` in this package and run in `pnpm test` — `cli/AGENTS.md`
covers the coupling.

## Rate limits

The ceilings a client or operator can hit, all enforced in
`src/services/rateLimit.ts` (which `tests/unit/documentedLimits.test.ts` holds
this list to):

- Signing in and signing up share the auth limiter: **10 a minute per (source
  IP, email address) pair**, **30 per 15 minutes per email address**, and
  **300 an hour per source IP**. The third exists because the first two are
  keyed on values the caller supplies; every attempt costs an argon2 verify, so
  an unauthenticated caller must not set the pace of the most expensive
  operation in the product.
- Account creation: **50 an hour per source IP**.
- `POST /api/auth/forgot-password`: **5 an hour per source IP** and
  **3 an hour per email address**.
- Invitations: 100 pending per project, 100 addresses looked up an hour per
  caller, **20 invitation emails an hour, per caller**, 3 re-mails an hour per
  invitation.
- Link attachments: 60 an hour per user.
- Notification email: the same notification at most once an hour, one sender
  causing at most 20 an hour to any one recipient, and a recipient receiving at
  most 100 an hour across all senders.

The realtime socket ceilings are listed under [Realtime](#realtime).

## Behavior

### Access, roles and visibility

Every project is visible to its creator and to the users in its
`project_member` set. The creator has implicit access and is never stored as a
member row; ownership is transferable (`PUT /api/projects/:id/owner`). Each
member row carries a **role**, `editor` or `viewer`: editors can do everything;
viewers can read everything, comment, order the project in their own list, and
leave. Every mutation of board content answers **403** to a viewer.

**404 versus 403.** Inaccessible projects return 404 everywhere, so a project
the caller cannot see stays indistinguishable from one that does not exist; 403
is reserved for a caller who can already read the row. Enforcement is central,
in `src/services/authorization.ts` — reads go through `assertProjectAccess` /
`assertTaskAccess`, mutations through `assertProjectWrite` /
`assertTaskWrite` — and any role value that is not exactly `editor` reads as a
viewer, so a future third role fails closed.

`project.created_by` is `ON DELETE RESTRICT`: an account cannot be deleted
while it still owns a project, so ownership has to move (or the project has to
go) first.

A user record is always `{ id, name, avatar_url }` — never an email address.
`GET /api/users` lists the caller plus everyone sharing a project with them;
`GET /api/users/search?q=` finds people beyond that set (word-prefix matching
on name, capped, no pagination) so a board can be shared by name. Copied
projects start personal: members are never copied.

### Sessions, tokens and cookies

Signing up or logging in creates a session row and returns its opaque token.
`GET /api/auth/sessions` lists the caller's live sessions and
`DELETE /api/auth/sessions/:id` revokes one, including the current one — that
is a sign-out of the device making the request. A session records the
`User-Agent` header verbatim and **no network address, here or anywhere**.
Expired sessions are omitted from the list. Revocation closes any WebSocket
authenticated with that session immediately, via `sessions_revoked`.

Signup and login also set the token as an HttpOnly `cp_session` cookie. It
exists for one reason: a browser never attaches an `Authorization` header to an
`<img>` tag, so the media routes (`/api/images/:id` and friends) cannot be
authenticated any other way. `SameSite=Lax` is the security property: the
cookie is not sent on cross-site subresource requests. Only the media routes
read it — they are all GETs that only read bytes, and every mutation still
requires the `Authorization` header, so the cookie is not a CSRF primitive.

A personal access token (PAT) is a named, long-lived credential for scripts and
agents, accepted anywhere a session token is, including the `/ws` handshake;
there are no scopes. `POST /api/auth/tokens` mints one (`cpat_`-prefixed) and
its response is the **only** time the secret is returned — only its sha256 hash
is stored. `GET /api/auth/tokens` lists them, expired included, so they can be
cleaned up; `DELETE` revokes. `last_used_at` is stamped on every successful
authentication — a REST request, a `/ws` handshake, or the 30-second heartbeat
of an open socket — throttled to one write per token per minute. A token can
mint further tokens, so revocation is the only reliable control over the access
one was granted.

### Password change and reset

`POST /api/auth/forgot-password` answers **204** when the address has an
account (mail queued) and **404** when none does. It is deliberately
informative: signup already answers `409 Email already in use` to anyone, so a
non-revealing response would buy nothing and cost every mistyped address a
silent wait.

Neither `change-password` nor `reset-password` revokes any session — the
sessions list is the lever for that, now that a user can revoke devices
individually. `reset-password` answers 200 with `{ token, user }` and signs its
caller in: redeeming the link proves control of the address, which is the same
proof signup takes. What both flows do rotate is `app_user.alternative_id`,
the subject of the stateless reset-token HMAC, which makes the used link
single-use and invalidates every other outstanding reset email. The link's
15-minute expiry is what bounds a leaked one.

### Pending invitations

Sharing a board with an address that has no account stores a
`project_invitation` row and emails a link. The row grants nothing until
claimed; claiming happens at signup with the invited address, or via
`POST /api/invitations/accept` with the token from the link — an invitation is
a grant to whoever holds the link. A claim deletes the row, so a claim and a
revoke racing cannot both succeed. Tokens are derived by HMAC from the row id
under `EMAIL_TOKEN_SECRET` rather than stored, which is what lets a resend
reproduce a link that was already sent; resending also repairs rows left
unredeemable by a rotation of the signing secret. Every write publishes
`invitations_changed`, the one editor-scoped event, carrying no address.

### Board semantics

- **Archiving is a soft delete, and the only way to a hard delete.**
  `DELETE /api/tasks/:id` refuses a task still on the board with a 422, so
  losing a card takes two deliberate steps with a reversible one in between.
  `POST /api/tasks/:id/restore` puts the card back where it left from, with
  every dependency edge intact. An archived card leaves the board, the task
  counts and any project copy, and disappears from the `blocker_ids` of the
  tasks it blocks; the project export still carries it, marked with its
  `archived_at`, and `GET /api/tasks/:id` still serves it. Archiving does not
  bump `updated_at`, because that would invalidate the `expected_updated_at`
  precondition every open editor is holding.
- **Duplicating** a card or a column copies content (title, description, due
  date, labels, assignees, checklist items, images) but never comments,
  activity, or dependency edges leaving the copied set — and notifies nobody:
  duplicating a card assigned to a teammate must not tell them they have been
  assigned something they have never seen.
- **Bulk routes** (`POST /api/tasks/batch`, `/api/tasks/bulk-move`,
  `bulk-archive`, `bulk-labels`, `bulk-assignees`, and the column-scoped
  `move-tasks` / `archive-tasks`) act on a set in one request and one
  transaction. Nothing fails wholesale: ids that are unknown or untouchable
  come back in `skipped_task_ids` and the rest commits, and an id in another
  project is indistinguishable from an unknown one, so the skip list is no
  cross-project existence oracle. Labels and assignees are deltas, not
  replaces. There is deliberately no bulk delete. Each emits one batched event,
  except `tasks/batch`, which emits one `task_created` per card.
- **A project holds at most 5,000 tasks** (`MAX_TASKS_PER_PROJECT`), archived
  cards included; every create path answers 422 past it. The single-create path
  takes no lock on the project row — it is the hottest write in the product —
  so concurrent creates may land a handful past the ceiling. The cap is a
  denial-of-service guard, not an invariant.
- **`GET /api/my-tasks`** is the one cross-project read of tasks: everything
  unarchived and unfinished assigned to the caller, filed by the server into
  `blocked` (an unfinished blocker), `blocking` (someone **else** waiting) or
  `ready`, with `waiting_user_ids` as the authoritative "you are the bottleneck
  for N people" count. Archived projects are excluded: archiving is the user's
  own "not now" signal.
- **`GET /api/search?q=`** matches task titles and description text across
  every reachable project, each word as a prefix, capped at 50 with a
  `truncated` flag. Matching runs off a stored generated column with `english`
  and `simple` arms, and the query side mirrors that — change one side without
  the other and matching silently degrades.
- **`PUT /api/projects/:id/position`** sets the caller's own rank for a
  project; **`PUT /api/projects/:id/seen`** moves their unseen-changes marker,
  and is the only thing that moves it, so nothing a script reads can clear
  somebody's dot. Board reads return `changed_task_ids`; the projects list
  returns `has_unseen_changes`.
- **Cross-project dependencies** are allowed: adding an edge needs write access
  on the blocked task's project and read on the blocker's; removing one needs
  write on the blocked side only. A cross-project blocker never enters
  `blocker_ids` — it arrives as one increment of a denormalized
  `open_cross_project_blocker_count`, so a board read never touches another
  project's rows. Edges whose far end the caller cannot read are reported as
  counts, never listed. Cycle detection walks every edge regardless of project.

### Comments, checklists, mentions and activity

- **Comments** are a flat, chronological stream per task in the same restricted
  Tiptap document descriptions use. Anyone with access may comment, **viewers
  included** — so comment handlers assert read access, not write — but
  `PATCH`/`DELETE` are your own comments only, with no moderation override.
- **Checklists** are one flat, ordered list per task, and
  `POST /api/checklist-items/:id/promote` turns an item into a card. All writes
  assert write access, and none touches the parent task's `updated_at`, for the
  same precondition reason as archiving.
- **Mentions** are a Tiptap node whose `label` is the writer's snapshot of the
  name, so a rename does not rewrite stored documents. Writes resolve newly
  added mentions only, and only project members; anyone else is stored as
  written and silently skipped, because a 422 would make an autosaving editor
  retry forever. A resolved mention sends email.
- **Task activity** (`GET /api/tasks/:id/activity`) is an append-only log
  written inside the transaction of the mutation it records, with names
  snapshotted at write time so an entry still reads correctly after what it
  names is renamed or deleted. Consecutive `description_changed` entries by one
  actor within five minutes are coalesced, because editors autosave on a
  debounce. No realtime event is published for activity; every mutation that
  writes an entry already publishes its own.

### Recurring series

A repeating commitment lives on a `task_series` row: the template plus an
RRULE, the calendar day of the next occurrence and its timezone.
**Materialization is lazy** — a periodic background sweep creates the card on
the day the occurrence falls, and editing a series changes future occurrences
only. The rule is stored as an RFC 5545 RRULE and evaluated with a library,
because month ends and leap years are where hand-rolled recurrence goes wrong;
the UI offers six presets and there is no general RRULE editor, but submitted
rules are bounded (one line, no more often than daily, `INTERVAL` ≤ 366,
`COUNT` ≤ 1000) since the API deliberately accepts input the UI cannot produce.

Scheduling is forward-only: a series anchored in the past backfills nothing,
and occurrences missed while the worker was down are counted into
`missed_occurrence_count` and never created. A due occurrence is created even
when the previous one is still open, because silently skipping hides work.
Three foreign keys deviate from "everything cascades", all `SET NULL`:
`task.series_id`, `task_series.column_id` and `task_series.created_by` —
deleting a column must not destroy the series that pointed at it, and a member
leaving must not take a project's schedules with them. Copying a project copies
its series with the next occurrence recomputed from today.

### Attachments and images

`task_attachment` holds three kinds — `file`, `link` and `image` — and is the
only place any of them lives. **Which kind an upload becomes is the server's
decision**: `POST /api/attachments/files` reads the first bytes, and PNG, JPEG,
GIF or WebP under 10 MB becomes an image; anything else a file under the 50 MB
cap (`ATTACHMENT_MAX_BYTES`). `PROJECT_STORAGE_QUOTA_BYTES` caps a whole
project, and a task holds at most 50 attachments. Upload bodies stream straight
to storage with the cap applied to the stream, so concurrent uploads cost a
chunk of memory each rather than a whole file each.

The safety of an arbitrary upload comes from how it is served, since nothing is
normalized on the way in: `GET /api/attachments/:id/download` always answers
`application/octet-stream` with `Content-Disposition: attachment`, `nosniff`
and a sandboxing CSP. It is authenticated with optional auth — a stranger is
served only when the board is published. `GET /api/images/:id` is
unauthenticated by contrast (it backs `<img>` tags) and is structurally unable
to reach a document's bytes: it selects only the image columns, which file rows
hold null. A viewer may download; only an editor may attach, rename or delete.
One image per task may be marked its cover (`PUT /api/tasks/:id/cover`); the
choice lives on the attachment row, so deleting the image takes the cover with
it.

**Link attachments** are stored immediately and unfurled by a background job
that re-fetches preview images into our own storage rather than hotlinking.
Unfurling is best-effort with no manual re-unfurl — a user-triggered,
repeatable server-side fetch of an attacker-chosen URL is what the SSRF rules
exist to prevent, and the fetcher reuses the webhook sender's target rules:
private/loopback/reserved ranges blocked, the vetted address pinned to the
socket, redirects re-validated, responses capped.

### Public boards

`PATCH /api/projects/:id { is_public: true }` publishes a project read-only;
`GET /api/public/projects/:id/board` then serves it to anyone who knows the id.
Any **editor** may flip the flag. The flag governs only the anonymous router —
it never widens what an authenticated handler answers — and the response is
shaped field by field from the ordinary board payload, so anything added to
that payload later stays private until published deliberately. Anonymous
viewers get no realtime. Responses are `no-store` with `X-Robots-Tag: noindex,
nofollow`; nothing enumerates published projects.

### Realtime

A WebSocket endpoint listens at `/ws` on the same server (not part of the
OpenAPI spec). Clients must send `{ "type": "auth", "token": "<session or
personal access token>" }` within 10 seconds of connecting, then may
`subscribe` / `unsubscribe` to project rooms. The server pings every 30 seconds
and expects a `pong`; a socket is closed with code 4401 when **its own**
credential is revoked or expires.

Every close code above the RFC 6455 ones is declared in
`src/services/realtime/closeCodes.ts` and published in `realtime-events.json`
as `RealtimeCloseCode`, and the ping interval likewise as
`RealtimeHeartbeatMs` — literal types rather than runtime values, which is what
lets a regenerated client ship without waiting for the api deploy.

Three ceilings bound what one caller can hold open: **200 live sockets from one
source address** (a handshake past it is answered 429 and the socket
destroyed), an account holding more than **20 sockets** has its oldest closed
with code 4429 (so the connection that just arrived survives), and a socket may
hold **1000 subscriptions**. All three are **per process**, unlike the rate
limiter, which shares counters through Redis — they bound what one process can
be made to hold, not what one person may have.

Every mutation emits an event after its transaction commits, in a
`{ type, project_id, data }` envelope; every board mutation's `data` carries
`actor_user_id` so a client can tell a teammate's change from an echo of its
own. The table below summarizes each payload; the machine-readable version is
served at `GET /api/realtime-events.json`, generated from the same declarations
the server publishes against.

| type                                                | data                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `task_created` / `task_updated`                     | board task shape                                                                                        |
| `task_deleted`                                      | `{ id }`                                                                                                |
| `task_archived`                                     | board task shape plus `archived_at`                                                                     |
| `task_restored`                                     | board task shape                                                                                        |
| `task_relations_set`                                | `{ task_id, label_ids, assignee_ids, blocker_ids, open_cross_project_blocker_count }`                   |
| `cross_project_blockers_changed`                    | `{ tasks }`, each `{ task_id, open_cross_project_blocker_count }`                                       |
| `column_created` / `column_updated`                 | column response shape                                                                                   |
| `column_deleted`                                    | `{ id, moved_tasks }`                                                                                   |
| `column_tasks_moved`                                | `{ column_id, target_column_id, moved_tasks }`                                                          |
| `column_tasks_archived`                             | `{ column_id, tasks }`                                                                                  |
| `column_tasks_reordered`                            | `{ column_id, moved_tasks }`                                                                            |
| `bulk_tasks_moved`                                  | `{ moved_tasks }`                                                                                       |
| `bulk_tasks_archived`                               | `{ tasks }`                                                                                             |
| `bulk_tasks_relations_set`                          | `{ tasks }`, each `{ task_id, label_ids, assignee_ids, blocker_ids, open_cross_project_blocker_count }` |
| `label_created` / `label_updated`                   | label row                                                                                               |
| `label_deleted`                                     | `{ id }`                                                                                                |
| `attachment_created`                                | attachment response plus `{ attachment_count }`                                                         |
| `attachment_updated`                                | attachment response shape                                                                               |
| `attachment_deleted`                                | `{ id, task_id, attachment_count, cover_image_url }`                                                    |
| `comment_created`                                   | comment row plus `{ comment_count }`                                                                    |
| `comment_updated`                                   | comment row                                                                                             |
| `comment_deleted`                                   | `{ id, task_id, comment_count }`                                                                        |
| `checklist_item_created` / `checklist_item_updated` | checklist item row plus both counts                                                                     |
| `checklist_item_deleted`                            | `{ id, task_id, checklist_item_count, checklist_done_count }`                                           |
| `series_created` / `series_updated`                 | recurring series shape                                                                                  |
| `series_deleted`                                    | `{ id }`                                                                                                |
| `project_created` / `project_updated`               | projects-list item (with `member_ids`, `members` and task counts, without the per-user `sort_key`)      |
| `project_deleted`                                   | `{ id }`                                                                                                |
| `project_position_updated`                          | `{ id, sort_key }`                                                                                      |
| `project_seen`                                      | `{ id }`                                                                                                |
| `project_changed`                                   | `{ id, actor_user_id }`                                                                                 |
| `invitations_changed`                               | `{ project_id }`                                                                                        |
| `user_updated`                                      | public user `{ id, name, avatar_url }`                                                                  |
| `sessions_revoked`                                  | `{ user_id }`, optionally plus `personal_access_token_id` or `session_id`                               |
| `account_updated`                                   | caller's own `{ id, name, avatar_url, email, email_verified }`                                          |

The `column_tasks_*` and `bulk_tasks_*` types are batched forms: one envelope
per call, with no per-task events alongside, because a fifty-card Done column
would otherwise cost fifty envelopes. Bulk task create has no batched
counterpart and emits one `task_created` per task.

Delivery: project-scoped events go to sockets subscribed to that project whose
user can access it (re-checked per event). `project_created` /
`project_updated` are broadcast to every authenticated socket under the same
check, so project lists stay current without a room; users who lose access get
a `project_deleted` eviction sent to a recipient list snapshotted inside the
transaction, since the post-commit re-check would exclude exactly the users who
need it. `invitations_changed` is the one **editor-scoped** event (its subject
is made of email addresses), and deliberately carries no address — an event
that never puts one on the wire cannot leak one however delivery later changes.
`sessions_revoked` is never delivered: the transport intercepts it and closes
sockets instead. `account_updated` is the one **self-only** event, which is why
it may carry the email address where `user_updated` may not.

### Outbound webhooks

A project can register up to ten HTTP(S) endpoints that receive a signed `POST`
for every board event it emits; the vocabulary is the realtime catalog above.
The routes are `POST/GET /api/webhooks`, `PATCH/DELETE /api/webhooks/:id`,
`POST /api/webhooks/:id/rotate-secret`, and a delivery log with manual
redelivery under `/api/webhooks/:id/deliveries`. The mutating routes are the
one deliberate exception to "every mutation emits a realtime event": a
registration is not board data, and publishing one would put the signing secret
on the realtime bus and make webhooks fire about themselves.

Every request body is one envelope — `{ id, version, type, project_id,
created_at, data }` — where `data` is exactly the realtime `data` for that
type, so the two cannot drift. Headers: `X-Critical-Path-Event`,
`X-Critical-Path-Delivery`, `X-Critical-Path-Webhook`,
`X-Critical-Path-Timestamp` (unix seconds) and `X-Critical-Path-Signature:
v1=<hex>`, an HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``. Verify it
against the raw body:

```js
import crypto from 'node:crypto';

const TOLERANCE_SECONDS = 300;

function verify(headers, rawBody, secret) {
  const signature = headers['x-critical-path-signature'];
  const timestamp = Number(headers['x-critical-path-timestamp']);
  if (typeof signature !== 'string' || !Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) return false;

  const expected = `v1=${crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')}`;
  // timingSafeEqual throws on a length mismatch, which is exactly what a forged
  // header looks like, so compare digests of equal length instead.
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(expected).digest(),
    crypto.createHash('sha256').update(signature).digest()
  );
}
```

The timestamp check matters: it is inside the signed string, so a captured
delivery cannot be replayed under a fresh one.

**Retries and guarantees.** A non-2xx, a connection error or a 10-second
timeout retries after 30s, 2m, 10m, 1h and 6h. After five consecutive exhausted
deliveries the registration is disabled; manual redeliveries never count toward
that threshold, and a redelivery restarts the retry cycle under the original
delivery id, so a receiver's idempotency key still matches. Delivery is
at-least-once and unordered: deduplicate on `X-Critical-Path-Delivery` and do
not infer ordering. Enqueueing is at-most-once — a pod that dies between commit
and the post-commit hook drops the event. One mutation can be many deliveries
(stripping 200 assignments sends 200 requests per registration); size receivers
accordingly. Terminal deliveries are kept for seven days.

**Secrets and targets.** The secret is stored and returned in plaintext — the
server signs with it, so it cannot be hashed. Every editor of the project can
read it; the list route omits it for a viewer, since holding it is enough to
forge a delivery. In production, webhook URLs must be `https` and may not
resolve to loopback, private, link-local, reserved or cloud-metadata addresses
— checked at registration and again after DNS resolution at connect time.
Redirects are never followed. Outside production the address rules are relaxed
so a development server can point a webhook at its own machine.

### Background jobs

Deferred and recurring server-side work runs off the `job` table, leased with
`for update ... skip locked` by a tick inside the API pods. There is no HTTP
surface: nothing about a job belongs to a project, and the authorization model
is project-scoped only. Registering a kind is a code change; registered kinds
are `attachment_unfurl` and the periodic sweeps `task_series_materialize` and
`assignment_digest`. Webhook delivery does **not** use this — `webhook_delivery`
keeps its own table for per-receiver behavior a generic table cannot hold.

A job with no interval is one-shot: it backs off (30s, 2m, 10m, 1h, 6h) and
then parks at `status = 'failed'`, retained rather than deleted because a
pruned poison job is an invisible one. A job with an interval is a schedule:
exactly one row per kind, re-armed on success, **never** retired on failure —
retiring a schedule would silently stop every occurrence it drives. Schedules
are declared by the handler, and each worker re-seeds what its registered
handlers ask for, so a changed interval takes effect without touching the
database by hand.

Enqueueing takes the caller's connection, so a job commits or rolls back with
the mutation that caused it. Delivery is at-least-once and the duplicate can be
concurrent — shutdown does not drain — so handlers must be idempotent under
concurrency, not merely under repetition, and must treat a target row that has
since been deleted as success. Payloads carry ids, never contact details
(`assertJobPayload` enforces it): nothing reviews what enters that column, so
an address written there would outlive every consent and access check that
authorized it. Failures are visible in the log, not over HTTP. The claim is
restricted to the kinds the claiming process registered, so an old pod leaves a
new release's kind alone during a rolling deploy.

### Email

All mail goes through the driver named by `EMAIL_DRIVER`: `console` (default —
logs the full email, so the reset link is usable from the server log in
development) or `ses` (AWS SES v2; needs `SES_FROM_ADDRESS`, a region, and
standard SDK credentials). `assertEmailConfig` checks that pair at boot,
because every send runs inside a post-commit hook where a throw is caught and
logged — a production deploy missing `SES_FROM_ADDRESS` would otherwise look
healthy while sending no mail. Every link the server mails is built in
`src/services/webLinks.ts` from `APP_URL_BASE`.

**Verification.** Every account carries `email_verified`, which gates
notification email and nothing else — account-access mail (verification,
password reset, feedback) always sends regardless. `POST
/api/auth/verify-email` takes a token and answers 204; it is unauthenticated
and inert, so a leaked link reveals nothing. Tokens are stateless HMACs
(`EMAIL_TOKEN_SECRET`, falling back to `PASSWORD_RESET_SECRET`) carrying a hash
of the address rather than the address itself, which both binds the token and
keeps addresses out of load-balancer logs. `email` and `email_verified` are
returned only to the caller about themselves; no user record discloses one
person's address to another anywhere else.

**Notifications.** Four events, and only four, produce email: `task_assigned`,
`bulk_task_assigned`, `added_to_project` and `mentioned` — all direct-address,
which is why none needs a per-project mute. Delivery is gated per recipient:
not the actor, a verified address, the kind not switched off, and access to the
project re-evaluated at send time. The budgets are listed under
[Rate limits](#rate-limits); the (recipient, sender) pair keying is the
load-bearing one — keyed on the recipient alone, a budget would be spent by
whoever causes the write, and the victim would take the spam *and* be silenced.
A refused message is dropped, not queued. `bulk_task_assigned` is a digest:
rows queue in `pending_assignment_notification` and a periodic job flushes a
group once its actor has been quiet for two minutes or fifteen minutes after
its oldest card, re-reading everything at send time. Every notification email
carries an unsubscribe link — a stateless HMAC with no expiry that can only
switch a preference *off* — and the RFC 8058 one-click headers. Preferences are
one boolean per kind via `GET`/`PATCH
/api/auth/me/notification-settings`, every key of the PATCH body optional, so
the release that adds a kind does not refuse saves from older clients.

**Avatars and feedback.** `POST /api/auth/me/avatar` sets the caller's avatar
(sniffed as PNG/JPEG/GIF/WebP, downscaled, re-encoded as WebP), `DELETE`
removes it, and `GET /api/avatars/:key` serves it with an immutable cache
header — every upload mints a fresh key, so avatar URLs never change content.
`POST /api/feedback` stores user feedback and emails it to
`FEEDBACK_EMAIL_ADDRESS` after the commit; the stored row is the source of
truth.

### Account and project export

`GET /api/auth/me/export` hands the calling account everything held about it
that is not board content, as one JSON download: the account record,
notification settings, sessions (expired included — nothing prunes them, so
the export must not filter them), personal access tokens, feedback, and a
pointer list of projects. **Nothing about another person appears in it, and no
credential material does** — no password hash, no token hashes, no
`alternative_id`, and no pending invitations in either direction.
`tests/unit/accountExportCoverage.test.ts` enumerates every foreign key
referencing `app_user`, so a new user-keyed table fails the suite until someone
decides whether the export carries it.

`GET /api/projects/:id/export` hands any project member everything in the
project: a streamed zip with a `project.json` manifest, a `tasks.csv` for
spreadsheets, and the real bytes of every attachment, archived cards included.
`?format=json` returns the manifest alone; the archive is plain zip, not zip64,
so a project past 4 GiB answers 413. `project.json` is the stable interchange
format the importer reads back, and `version` is bumped only on a breaking
shape change. Ids are the original server ids; every reference resolves against
the manifest's own `users[]`, `labels[]`, `columns[]` and `tasks[]`. A task's
dependencies on other projects are **not** exported — an export is one project
— only the bare `open_cross_project_blocker_count` rides along. Embedded
`/api/images/<uuid>` sources resolve by id against the flattened
`tasks[].attachments[]`; tolerate a source that resolves to nothing. `path` is
derived from the id, never from `filename`, so an archive can never carry a
traversal path or a name collision. `tasks.csv` writes values exactly as typed
— a title starting with `=` is not escaped — so treat it opened in a
spreadsheet like any other untrusted CSV.

Comments are exported by no route yet; adding them is a version bump, and it
has to answer what a mention node carrying another person's name and id means
in a file the exporter keeps.

### Account deletion

`DELETE /api/auth/me` permanently destroys the calling account; the body
carries the current password, and there is no undo. **Owned shared boards block
the delete**: an account that still owns a project with members gets a 409
naming them (`blocking_projects`), and ownership has to move or the project has
to go first. One transaction then removes the owned projects and the
`app_user` row, which cascades to everything else. Storage objects are deleted
from `postCommitHooks`, except anything uploaded into someone else's project —
the row survives with its project, and deleting the object would break a live
card someone else owns.

## Known limitations

- There is no bounce or complaint handling: a hard bounce is invisible to the
  application, and verification is the only lever — which is what notification
  email is gated on.
- Accounts created before email verification shipped read as unverified until
  they confirm, so they receive no notification email until then.
- `POST /api/projects/:id/members/by-email` and `GET /api/users?email=` tell a
  caller whether an address has an account, within sets they can already
  enumerate; signup's 409 leaks the same fact to anyone. That is accepted:
  addresses are input-only everywhere and no route returns one the caller did
  not supply.
- Ordering is a fractional index, so inserting repeatedly against the same
  neighbor lengthens each successive key; a key that hits the 1024-character
  cap is refused with a 422, and `POST /api/columns/:id/reorder` re-stamps the
  column to clear it.
- Project roles are only `editor` and `viewer`; only the owner can transfer
  ownership or delete the project. A project can never end up with no editor,
  since the creator is always one.
- `GET /api/images/:id` answers to project access, or to anyone once the board
  is published; `GET /api/avatars/:key` answers any signed-in caller, and an
  anonymous one when the owner appears on a published board.
- Task images and files are stored exactly as uploaded — no resizing, no
  re-encoding (only avatars and link previews are re-encoded). File safety
  comes from how downloads are served, not from a separate origin; the download
  route is the only reader of `task_attachment.storage_key` and is the place
  that has to keep that promise.
- Attachment downloads support no Range requests: the storage interface returns
  a whole buffer, so a download costs its full size in pod memory. Uploads
  stream; downloads do not.
- A published board is readable by anyone who ever held the project id, and
  unpublishing takes the embedded images with it; there is no separate,
  rotatable slug.
- Account deletion reaches database rows and storage objects, not logs. With
  `EMAIL_DRIVER=console`, emailed content (feedback text, reset links) outlives
  the account in the application log and ages out with the log platform's
  retention. Open clients of other members also keep showing the deleted user's
  comments until they refetch — the rows are gone; only the open view is stale.
