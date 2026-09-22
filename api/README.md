# Critical Path — api

TypeScript API for **Critical Path**, a project-management suite (Hono + Kysely + Postgres).

This is the `api/` package of the Critical Path monorepo. `web/` is the frontend,
`cli/` is the `cpath` command-line client, and `preview-edge/` serves PR
previews. Each package installs on its own; there is no pnpm workspace. Commands
below run from this directory unless they name another package.

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

Create `api/.env.test` for the test suite — both env files live in this package,
not at the top of the checkout:

```
DB_USER=skylerberg
DB_DATABASE=critical_path_test
STORAGE_DISK_ROOT=./data/test-uploads
ENVIRONMENT=test
```

`DB_DATABASE` here is the _base_ name: each checkout derives and creates its
own `critical_path_test_api_<hash>` from it, so parallel worktrees never
share a test database. See [Testing](#testing).

For a worktree rather than a fresh clone, `scripts/new-worktree.sh <branch>` at
the **repository root** does the install half for all four packages and copies
both env files across.

## Development

```sh
pnpm run dev                 # watch mode on http://localhost:3001
pnpm start                   # run once
```

Swagger UI at `http://localhost:3001/api/docs`, spec at `/api/openapi.json`.
`pnpm run openapi:dump` writes the post-processed spec to `./openapi.json`
without starting a server. The page serves Swagger UI's own bundle out of the
image rather than from a CDN: the SPA keeps its session token in this origin's
`localStorage`, so a third-party script tag on the docs page would be a third
party holding every reader's credentials.

Clients are identified by socket address, by one derivation
(`src/services/clientIp.ts`) shared by the rate limiters and the realtime
socket ceiling. When deploying behind a reverse proxy that appends the client
IP to `X-Forwarded-For`, set `TRUST_PROXY=true` so a forwarded entry is used
instead; leave it unset otherwise, since the header is client-forgeable.
`TRUST_PROXY_HOPS` says how many entries the proxies append, counted from the
right (production sets it to `2`: a GCP HTTPS load balancer appends
`<client-ip>, <lb-ip>`). A hop count too low reads a forged entry as the
client; too high falls back to the socket address, which behind a load balancer
is one bucket for the whole internet.

Signing in and signing up share the auth limiter: **10 a minute per (source
IP, email address) pair**, **30 per 15 minutes per email address**, and
**300 an hour per source IP**. The third exists because the first two are
keyed on values the caller supplies; every attempt costs an argon2 verify, so
an unauthenticated caller must not set the pace of the most expensive
operation in the product. Account creation is capped separately at
**50 an hour per source IP**, and `POST /api/auth/forgot-password` at
**5 an hour per source IP** and **3 an hour per email address**. The constants
live in `src/services/rateLimit.ts`, which
`tests/unit/documentedLimits.test.ts` holds this file to.

### Project members and access

Every project is visible to its creator and to the users in its
`project_member` set. The creator has implicit access and is never stored as a
member row. Ownership is transferable (`PUT /api/projects/:id/owner`), and a
transfer swaps the two representations.

Each member row carries a **role**, `editor` or `viewer`, and project responses
carry a `members` array of `{ user_id, role }` alongside the older
`member_ids` (same set, kept for clients written before roles existed).
Editors can do everything; viewers can read everything, comment, order the
project in their own list, and leave. Every mutation of board content answers
**403** `{"error":"Read-only access to this project"}` to a viewer.

**404 versus 403.** Inaccessible projects return 404 everywhere, so a project
the caller cannot see stays indistinguishable from one that does not exist; 403
is reserved for a caller who can already read the row. Enforcement is central,
in `src/services/authorization.ts`: reads go through `assertProjectAccess` /
`assertTaskAccess` and mutations through `assertProjectWrite` /
`assertTaskWrite`. Any role value that is not exactly `editor` is treated as a
viewer, so a future third role fails closed.

`PUT /api/projects/:id/members` replaces the member set and/or changes roles;
omitting `user_ids` changes roles only and can never add or remove anyone.
`POST /api/projects/:id/members/by-email` shares with one address, adding an
existing account straight away and storing a pending invitation otherwise.
`DELETE /api/projects/:id` cascades the whole board and is owner-only.

`project.created_by` is `ON DELETE RESTRICT`, so an account cannot be deleted
while it still owns a project — ownership has to move (or the project has to
go) first.

Copied projects start personal: members are never copied from the source.
`GET /api/users` returns the caller plus every user sharing a project with
them, and `GET /api/users/search?q=` finds people the caller shares nothing
with (word-prefix matching on name, capped, no pagination) so a board can be
shared by name. A user record is always `{ id, name, avatar_url }` — never an
email address.

### Pending invitations

Sharing a board with an address that has no account stores a
`project_invitation` row and emails a link. The row grants nothing until
claimed; claiming happens at signup with the invited address, or via
`POST /api/invitations/accept` with the token from the link (an invitation is a
grant to whoever holds the link). A claim deletes the row, so a claim and a
revoke racing cannot both succeed. Tokens are derived by HMAC from the row id
under `EMAIL_TOKEN_SECRET` rather than stored, which is what lets a resend
reproduce a link that was already sent; resending also repairs rows left
unredeemable by a rotation of the signing secret.

Limits: 100 pending invitations per project, plus three hourly budgets — 100
addresses looked up per caller, **20 invitation emails an hour, per caller**,
and 3 re-mails per invitation — the first two spent in a way that keeps a 429
from revealing whether an address has an account. Every write publishes
`invitations_changed`, the one editor-scoped event, carrying no address.

### Sessions

Signing up or logging in creates a session row and returns its opaque token.
`GET /api/auth/sessions` lists the caller's live sessions (`is_current` marks
the one the request was made with) and `DELETE /api/auth/sessions/:id` revokes
one, including the current one — that is a sign-out of the device making the
request. A session records the `User-Agent` header verbatim, truncated, and
**no network address, here or anywhere**. Expired sessions are omitted from the
list and deleted when next presented. Revocation closes any WebSocket
authenticated with that session immediately, via `sessions_revoked`.

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

### The session cookie

Signup and login also set the token as an HttpOnly `cp_session` cookie. It
exists for one reason: a browser never attaches an `Authorization` header to an
`<img>` tag, so the media routes (`/api/images/:id` and friends) cannot be
authenticated any other way. `SameSite=Lax` is the security property: the
cookie is not sent on cross-site subresource requests. Only a session token is
ever written to it, and only the media routes read it — they are all GETs that
only read bytes, and every mutation still requires the `Authorization` header,
so the cookie is not a CSRF primitive.

### Personal access tokens

A personal access token (PAT) is a named, long-lived credential for scripts and
agents, accepted anywhere a session token is, including the `/ws` handshake.
There are no scopes.

- `POST /api/auth/tokens` (`{ id, name, expires_at? }`) mints one; the response
  is the **only** time the secret is returned — only its sha256 hash is stored.
  Secrets are prefixed `cpat_`.
- `GET /api/auth/tokens` lists them, expired ones included, so they can be seen
  and cleaned up.
- `DELETE /api/auth/tokens/:id` revokes one.

`last_used_at` is stamped on every successful authentication — a REST request,
a `/ws` handshake, or the 30-second heartbeat of a socket already open —
throttled to one write per token per minute on the pool. A token can mint
further tokens, so revocation is the only reliable control over the access one
was granted.

### Task comments

Each task carries a flat, chronological comment stream. Bodies are the same
restricted Tiptap document task descriptions use. `POST /api/comments` creates;
`PATCH`/`DELETE /api/comments/:id` edit and remove **your own** only — anyone
else's answers 404, and there is no moderation override. Any member may
comment, **viewers included**, so the comment handlers assert read access
rather than write access. `GET /api/tasks/:id` embeds the stream, and every
board task carries `comment_count`.

### Card checklists

Each task carries one flat, ordered checklist (`POST`/`PATCH`/`DELETE
/api/checklist-items…`), and `POST /api/checklist-items/:id/promote` turns an
item into a card. All four assert **write** access: a checklist is card
content, not discussion. Every board task carries `checklist_item_count` and
`checklist_done_count` as correlated subqueries computed at read time, so they
cannot drift. No checklist write touches the parent task's `updated_at`:
bumping it would invalidate the `expected_updated_at` precondition every open
editor is holding. Items are copied by a card, column or project duplicate,
text and ticked state verbatim.

### Recurring series

A repeating commitment lives on a `task_series` row: the template (title,
description, labels, assignees, checklist items, destination column) plus an
RRULE, the calendar day of the next occurrence and its timezone. **Materialization
is lazy** — a periodic background sweep creates the card on the day the
occurrence falls; editing a series changes future occurrences only. The rule is
stored as an RFC 5545 RRULE and evaluated with a library, because month ends
and leap years are where hand-rolled recurrence goes wrong; the UI offers six
presets and there is no general RRULE editor. Submitted rules are bounded (one
line, no more often than daily, `INTERVAL` ≤ 366, `COUNT` ≤ 1000) since the API
deliberately accepts input the UI cannot produce.

Scheduling is forward-only: a series anchored in the past backfills nothing,
and occurrences missed while the worker was down are counted into
`missed_occurrence_count` and never created. A due occurrence is created even
when the previous one is still open, because silently skipping hides work.
Three deviations from "all FKs cascade": `task.series_id`,
`task_series.column_id` and `task_series.created_by` are `SET NULL` — deleting
a column must not destroy the series that pointed at it, and a member leaving
must not take a project's schedules with them. Copying a project copies its
series with the next occurrence recomputed from today.

### Mentions

`mention` is a node in the restricted Tiptap allow-list, with attrs
`{ id, label }` — the label is the writer's snapshot of the name, so a rename
does not rewrite stored documents. Writes resolve **newly added** mentions
only, and only project members are resolved; anyone else is stored as written
and silently skipped, because a 422 would make an autosaving editor retry
forever. A resolved mention sends the `mentioned` notification email, keyed per
card so a thread naming the same person all afternoon is one email an hour.

### Task activity

`GET /api/tasks/:id/activity` serves an append-only log of what happened to a
task, oldest first: `{ id, kind, actor_user_id, old_value, new_value,
created_at }`. Entries are written inside the transaction of the mutation they
record, only when something actually changed, with names snapshotted at write
time so an entry still reads correctly after the thing it names is renamed or
deleted. Side effects are logged on the cards they change — deleting a column
logs a `column_changed` on every task it relocates. Consecutive
`description_changed` entries by the same actor within five minutes are
coalesced, because editors autosave on a debounce; that coalescing is the only
case where an existing entry is rewritten. No realtime event is published for
activity; every mutation that writes an entry already publishes its own.

### Card cover images

One of a task's images can be marked as the card's cover; every board task
carries `cover_image_url`. `PUT /api/tasks/:id/cover` (`{ image_id }`) sets it
and `{ image_id: null }` clears it. The choice lives on the attachment row, so
deleting the image takes the cover with it. Covers are copied on duplicate and
published on public boards.

### Attachments

`task_attachment` holds three kinds — `file`, `link` and `image` — and is the
only place any of them lives. `attachments[]` and `attachment_count` cover all
three; an image entry also carries `is_cover` and an `image_url`.

**Which kind an upload becomes is the server's decision.**
`POST /api/attachments/files` reads the first bytes: PNG, JPEG, GIF or WebP
under 10 MB becomes `kind: "image"`, anything else `kind: "file"` under the 50
MB cap (`ATTACHMENT_MAX_BYTES`). The declared `content_type` never decides.
`PROJECT_STORAGE_QUOTA_BYTES` (1 GiB by default) caps a whole project, images
included, and a task holds at most 50 attachments. Upload bodies are piped
straight to storage, with the byte cap applied to the stream, so concurrent
uploads cost a chunk of memory each rather than a whole file each.

`GET /api/attachments/:id/download` always answers
`application/octet-stream` with `Content-Disposition: attachment`, `nosniff`
and a sandboxing CSP, whatever the file is — the safety of an arbitrary upload
comes from how it is served, since nothing is normalized on the way in. It is
authenticated, with optional auth: a stranger is served only when the board is
published. `GET /api/images/:id` is unauthenticated by contrast (it backs
`<img>` tags) and is structurally unable to reach a document's bytes: it
selects only the image columns, which file rows hold null. A viewer may
download; only an editor may attach, rename or delete.

**Links.** `POST /api/attachments/links` stores the URL and answers 201 with
`unfurl_state: "pending"`; a background job then fetches the page and fills in
title, description, preview image and favicon (both re-fetched into our own
storage rather than hotlinked, so rendering a card leaks no viewer's IP).
Unfurling is best-effort with no manual re-unfurl — a user-triggered,
repeatable server-side fetch of an attacker-chosen URL is what the SSRF rules
exist to prevent. The fetcher reuses the webhook sender's target rules:
private/loopback/reserved ranges blocked, the vetted address pinned to the
socket, redirects re-validated, responses capped. Attaching a link is rate
limited to 60 an hour per user.

Rows cascade from the task; duplicating a card, column or project copies both
kinds with freshly copied storage objects.

### Archived tasks

`POST /api/tasks/:id/archive` is a soft delete; `POST /api/tasks/:id/restore`
puts the card back in the column and position it left from, with every
dependency edge intact. `GET /api/projects/:id/archived-tasks` lists the
archive. Archiving is the only way to a hard delete: `DELETE /api/tasks/:id`
refuses a task still on the board with a 422, so losing a card takes two
deliberate steps with a reversible one in between. An archived task leaves the
board, the task counts and any project copy, and disappears from the
`blocker_ids` of the tasks it blocks; the project export still carries it,
marked with its `archived_at`, and `GET /api/tasks/:id` still serves it. Archiving does not
bump `updated_at`, for the same precondition reason as checklist writes.

### Cross-project dependencies

A `task_dependency` edge may join tasks in two different projects. Adding one
needs write access to the **blocked** task's project and read access to the
blocker's; removing one needs write on the blocked side only. `blocker_ids`
holds same-project blockers only, so a board read never touches another
project's rows; a cross-project blocker arrives as one increment of
`open_cross_project_blocker_count`, a denormalized count maintained in the same
transaction as whatever moved it (the recompute is absolute, so a count that
drifts heals).
`GET /api/tasks/:id/cross-project-dependencies` serves the edges lazily in both
directions; an edge whose other end the caller cannot read is not listed but
added to `hidden_blocked_by_count` / `hidden_blocking_count`. Public boards
omit the count: it is a live measurement of a project that never agreed to be
published. Cycle detection walks every edge regardless of project.

### Bulk column actions

`POST /api/columns/:id/move-tasks` (`{ target_column_id }`) empties a column
into another without deleting it; archived cards stay put.
`POST /api/columns/:id/archive-tasks` archives every live task in the column
with one shared `archived_at`. Both emit one batched event rather than one per
task, and neither bumps `updated_at`.

### Duplicating a card or a column

`POST /api/tasks/:id/duplicate` copies one card, `POST
/api/columns/:id/duplicate` a column plus every live card in it. A copy takes
the title, description, due date, labels, assignees, checklist items and images
(each copied to its own stored object, with description `src`s rewritten).
Comments and activity history are not copied. A dependency edge is copied only
when both ends are inside the copied set. A copy notifies nobody — duplicating
a card assigned to a teammate must not tell them they have been assigned
something they have never seen.

### How many cards a project holds

A project holds at most **5,000 tasks** (`MAX_TASKS_PER_PROJECT` in
`src/config/constants.ts`). Every path that creates one answers **422** past
it. Archived cards count. The single-create path deliberately takes no lock on
the project row — it is the hottest write in the product — so concurrent
creates may land a handful of rows past the ceiling; the copy and duplicate
paths do lock, since each adds thousands of rows at once. The cap is a
denial-of-service guard, not an invariant.

### Bulk task create

`POST /api/tasks/batch` (`{ project_id, column_id, tasks }`) creates 1 to 100
tasks in one column, for pasting a list. The batch is all or nothing: a
duplicate id is a 409 that creates none of them, so a retry after a dropped
response cannot double-create. Each created task gets its own `task_created`
event — clients that handle single creates need no new code.

### Bulk actions on a selection

Four routes act on an arbitrary set of a project's cards in one request and one
transaction:

| route                            | body                                                          | 200                                 |
| -------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `POST /api/tasks/bulk-move`      | `{ project_id, task_ids, column_id }`                         | `{ moved_tasks, skipped_task_ids }` |
| `POST /api/tasks/bulk-archive`   | `{ project_id, task_ids }`                                    | `{ tasks, skipped_task_ids }`       |
| `POST /api/tasks/bulk-labels`    | `{ project_id, task_ids, add_label_ids?, remove_label_ids? }` | `{ tasks, skipped_task_ids }`       |
| `POST /api/tasks/bulk-assignees` | `{ project_id, task_ids, add_user_ids?, remove_user_ids? }`   | `{ tasks, skipped_task_ids }`       |

There is deliberately no bulk delete: deletion is only ever reachable from the
archive, one card at a time. Nothing fails wholesale — ids that are unknown or
untouchable come back in `skipped_task_ids` and the rest commits, and an id in
another project is indistinguishable from an unknown one, so the skip list is
no cross-project existence oracle. Labels and assignees are **deltas, not
replaces**: a selection rarely shares a label set, and replacing would multiply
the lost-update window by the size of the selection. Each route emits exactly
one event and no per-task events, and none is a webhook event. A bulk
assignment sends one coalesced digest per added user rather than one email per
card.

### My tasks

`GET /api/my-tasks` is the one cross-project read of tasks: every unarchived,
unfinished task assigned to the caller. The server files each task into
`blocked` (an unfinished blocker), `blocking` (someone **else** waiting on it)
or `ready`, and the client may not re-derive the buckets. Each task carries its
unfinished blockers and dependents, plus `waiting_user_ids` — the authoritative
"you are the bottleneck for N people" count. The companion arrays
`waiting_on_you` and `you_are_waiting_on` group the same edges by person, with
links in unreadable projects filtered out and reported as hidden counts.
Archived projects are excluded: archiving is the user's own "not now" signal.

### Public boards

`PATCH /api/projects/:id { is_public: true }` publishes a project read-only;
`GET /api/public/projects/:id/board` then serves it to anyone who knows the id.
Any **editor** may flip the flag. The flag governs only the anonymous router —
it never widens what an authenticated handler answers — and the response is
shaped field by field from the ordinary board payload, so anything added to
that payload later stays private until published deliberately. Anonymous
viewers get no realtime. Responses are `no-store` and carry `X-Robots-Tag:
noindex, nofollow`; nothing enumerates published projects.

### Search

`GET /api/search?q=` matches task titles and the plain text of descriptions
across every project the caller can reach, flat and relevance-ordered, with
inaccessible projects indistinguishable from empty ones. Every word in `q` must
match, each as a prefix. Matching runs off `task.search_vector`, a stored
generated column with four arms — title and description under `english` and
under `simple` — and the query side mirrors that; change one side without the
other and matching silently degrades (the `simple` arms are what keep mid-word
prefix matching from regressing against stemmed lexemes). Results are capped at
50; `truncated` says whether more matched.

### Per-user project ordering

`PUT /api/projects/:id/position` (`{ sort_key }`) upserts the caller's rank for
a project without affecting anyone else's; `GET /api/projects` orders by it
with nulls last, then `created_at`.

### What changed since you last looked

`PUT /api/projects/:id/seen` moves the caller's marker for a project to now; it
is the only thing that moves it, so nothing a script reads can clear somebody's
dot. Two reads answer from it: `GET /api/projects` returns `last_seen_at` and
`has_unseen_changes`, and board reads return `changed_task_ids`. "Changed"
means a live card carrying an activity or comment row written by somebody else
after the marker. With no marker, nothing reports as unseen rather than
everything.

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
source address** (a handshake past it is answered 429 and the socket destroyed),
an account holding more than **20 sockets** has its oldest closed with code
4429 (so the connection that just arrived survives), and a socket may hold
**1000 subscriptions**. All three are **per process**, unlike the rate limiter,
which shares counters through Redis — they bound what one process can be made
to hold, not what one person may have.

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
for every board event it emits. The vocabulary is the realtime catalog above —
there is no second event language.

| Method   | Path                                                 | Purpose                                                                       |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST`   | `/api/webhooks`                                      | Register `{ id, project_id, url }`; the response carries the generated secret |
| `GET`    | `/api/webhooks?project_id=`                          | List a project's registrations, with their secrets for an editor              |
| `PATCH`  | `/api/webhooks/:id`                                  | Change `url`, or disable / re-enable with `disabled_at`                       |
| `DELETE` | `/api/webhooks/:id`                                  | Remove a registration and its delivery log                                    |
| `POST`   | `/api/webhooks/:id/rotate-secret`                    | Replace the signing secret                                                    |
| `GET`    | `/api/webhooks/:id/deliveries?limit=`                | Delivery log, newest first, default 20, max 50                                |
| `POST`   | `/api/webhooks/:id/deliveries/:deliveryId/redeliver` | Re-send one failed delivery                                                   |

The mutating routes are the one deliberate exception to "every mutation emits a
realtime event": a registration is not board data, and publishing one would put
the signing secret on the realtime bus and make webhooks fire about themselves.

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

**Retries.** A non-2xx, a connection error or a 10-second timeout retries after
30s, 2m, 10m, 1h and 6h, six attempts in all. After five consecutive exhausted
deliveries the registration is disabled; manually re-sent deliveries never
count toward that threshold, so debugging a broken receiver cannot disable the
registration you are debugging. _Redeliver_ restarts the whole retry cycle
under the original delivery id, so a receiver's idempotency key still matches.

**Guarantees.** Delivery is at-least-once and unordered: deduplicate on
`X-Critical-Path-Delivery` and do not infer ordering. Enqueueing is
at-most-once — a pod that dies between commit and the post-commit hook drops
the event. One mutation can be many deliveries (a `PUT
/api/projects/:id/members` that strips 200 assignments sends 200 requests per
registration); size receivers accordingly.

**Secrets.** The secret is stored and returned in plaintext — the server signs
with it, so it cannot be hashed. Every editor of the project can read it; the
list route omits it for a viewer, since holding it is enough to forge a
delivery.

**Target restrictions.** URLs may not carry credentials and must be
`http`/`https`. In production `https` is required and loopback, private,
link-local, reserved and cloud-metadata addresses are refused, both at
registration and again after DNS resolution at connect time. Redirects are
never followed. Outside production the address rules are relaxed so a
development server can point a webhook at its own machine.

**Log retention.** Terminal deliveries are kept for seven days; live retries
are never pruned.

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

Password-reset, email-verification, board-invitation, notification and feedback
emails all go through the driver named by `EMAIL_DRIVER`:

- `console` (default) — logs the full email; the reset link is usable from the
  server log in development.
- `ses` — sends via AWS SES v2. Requires `SES_FROM_ADDRESS`, a region, and
  standard AWS SDK credentials in the environment.

`assertEmailConfig` in `src/config/env.ts` checks that pair at boot, because
every send runs inside a post-commit hook where a throw is caught and logged —
a production deploy missing `SES_FROM_ADDRESS` would otherwise look healthy
while sending no mail. `PASSWORD_RESET_SECRET` signs reset tokens and is
required in production. Every link the server mails is built in
`src/services/webLinks.ts` from `APP_URL_BASE`.

`POST /api/feedback` (authenticated) stores user feedback and emails it to
`FEEDBACK_EMAIL_ADDRESS` after the transaction commits; the stored row is the
source of truth either way.

### Email verification

Every account carries `email_verified`. It starts false, turns true when the
address is confirmed, and returns to false whenever the account moves to a
different mailbox. Verification gates notification email and nothing else;
**account-access mail always sends regardless** (verification, password reset,
feedback).

`POST /api/auth/verify-email` takes `{ token }` and answers 204; it is
unauthenticated and inert — the token creates no session and reveals nothing
about the account. `POST /api/auth/verify-email/resend` mails a fresh link.
Tokens are stateless HMACs (`EMAIL_TOKEN_SECRET`, falling back to
`PASSWORD_RESET_SECRET`) carrying a hash of the address rather than the address
itself, which both binds the token and keeps addresses out of load-balancer
logs. `email` and `email_verified` are returned only to the caller about
themselves (the `Me` shape); no user record discloses one person's address to
another anywhere else.

### Notification email

Four events, and only four, produce email: `task_assigned`,
`bulk_task_assigned`, `added_to_project` and `mentioned`. All are
direct-address — somebody put your name on something — which is why none needs
a per-project mute. Delivery is gated per recipient: not the actor, a verified
address, the kind not switched off, and access to the project re-evaluated at
send time. The gates are not in the email sender, which is what keeps
account-access mail sending unconditionally.

Three budgets bound what any one mailbox can be made to receive: the same
notification at most once an hour, one **sender** causing at most 20 an hour to
any one recipient, and a recipient receiving at most 100 an hour across all
senders. The second is keyed on the (recipient, sender) pair — keyed on the
recipient alone, a budget would be spent by whoever causes the write, and the
victim would take the spam *and* be silenced. A refused message is dropped, not
queued, and the budgets are checked and charged as one atomic step. Every
notification email carries an unsubscribe link (a stateless HMAC with no
expiry, authorizing only switching a preference *off*) and the RFC 8058
one-click headers.

The bulk assignment digest coalesces a selection assigned in one sitting into a
single "Skyler assigned you 20 cards in Roadmap" message: rows queue in
`pending_assignment_notification` and a periodic job flushes a group once its
actor has been quiet for two minutes or fifteen minutes after its oldest card.
Everything is re-read at send time, so cards archived or unassigned in the
meantime are dropped.

Preferences are one boolean per kind, all defaulting to true, via
`GET`/`PATCH /api/auth/me/notification-settings`. Every key of the PATCH body
is optional — that is what stops the release that adds a kind from refusing
every save made by a client that predates it.

### User avatars

`POST /api/auth/me/avatar` (multipart, max 10 MB) sets the caller's avatar: the
upload must sniff as PNG, JPEG, GIF or WebP and is normalized server-side
(downscaled to fit 1024x1024, re-encoded as WebP). `DELETE` removes it. `GET
/api/avatars/:key` serves the stored bytes with an immutable year-long cache
header — every upload mints a fresh key, so avatar URLs never change content.

### Account deletion

`DELETE /api/auth/me` permanently destroys the calling account; the body carries
the current password, and there is no undo. **Owned shared boards block the
delete**: an account that still owns a project with members gets a 409 naming
them (`blocking_projects`), and ownership has to move or the project has to go
first. One transaction then removes the owned projects and the `app_user` row,
which cascades to everything else. Storage objects are enumerated inside the
transaction and deleted from `postCommitHooks`; anything the account uploaded
into someone else's project is deliberately left alone — the row survives with
its project, and deleting the object would break a live card someone else
owns. The caller's sockets close via `sessions_revoked`.

### Account export

`GET /api/auth/me/export` hands the calling account everything held about it
that is not board content, as one JSON download: the account record,
notification settings, sessions (expired included — nothing prunes them, so
the export must not filter them), personal access tokens, feedback, and a
pointer list of projects. **Nothing about another person appears in it, and no
credential material does** — no password hash, no token hashes, no
`alternative_id`, and no pending invitations in either direction. It is not
metered: every collection in it is already readable one endpoint at a time.

`tests/unit/accountExportCoverage.test.ts` enumerates every foreign key
referencing `app_user` and every column of the account-owned tables, so a new
user-keyed table or column fails the suite until someone decides whether the
export carries it.

### Project export

`GET /api/projects/:id/export` hands any project member everything in the
project: a streamed zip with a `project.json` manifest, a `tasks.csv` for
spreadsheets, and the real bytes of every attachment under
`attachments/<id>.<ext>`, archived cards included. `?format=json` returns the
manifest alone. The archive is plain zip, not zip64, so a project past 4 GiB
answers 413 and has to be exported as JSON plus per-object fetches.

`project.json` is the stable, documented interchange format the importer reads
back. `version` is bumped only on a breaking shape change. Ids are the original
server ids; every reference resolves against the manifest's own `users[]`,
`labels[]`, `columns[]` and `tasks[]`. A task's dependencies on other projects
are **not** in the export — an export is one project — only the bare
`open_cross_project_blocker_count` rides along. `description` is stored
verbatim, so its embedded `/api/images/<uuid>` sources resolve by id against
the flattened `tasks[].attachments[]`; tolerate a source that resolves to
nothing. `path` is derived from the id, never from `filename`, so an archive
can never carry a traversal path or a name collision.

`tasks.csv` writes values exactly as the user typed them — a title starting
with `=` is not escaped, so treat it opened in a spreadsheet like any other
untrusted CSV. Use `project.json` when you need exactness.

Comments exist but are exported by no route yet; adding them is a version bump,
and it has to answer what a mention node carrying another person's name and id
means in a file the exporter keeps.

## Database workflow

Migrations live in `src/db/migrations/` (Kysely `Migrator`, numbered
`<NNNN>_<name>.ts` files exporting `up`/`down`).

```sh
pnpm run migrate             # dev DB to latest
pnpm run migrate:down        # dev DB one step down
pnpm run migrate:test        # test DB to latest
```

After changing the schema, regenerate the committed types:

```sh
pnpm run kysely-codegen
```

No argument, and in particular no `DATABASE_URL`: `scripts/codegen-types.ts`
loads `.env.test` for the connection settings, builds a scratch database from
`src/db/migrations`, introspects that one and drops it again. Aiming it at
`critical_path` instead commits whatever an abandoned branch left in that
database as though a migration had created it. The file it writes is
`src/db/types.generated.ts`; `src/db/types.ts` is hand-written, imports that
one and is what the rest of the app imports.

## Testing

```sh
pnpm test                    # full suite against this checkout's own database
pnpm run test:watch
pnpm run test:coverage
pnpm run test:db:prune       # drop test databases whose checkout is gone
```

The suite loads `.env.test`, migrates the test DB in global setup, and
truncates all tables at suite start — never point it at a database with data
you care about.

### One database per checkout

The test database name is **derived, not configured**. `vitest.config.ts` takes
`DB_DATABASE` from `.env.test` as a base — it must end in `_test` — and appends
this package directory's name and a sha256 of its absolute path, giving e.g.
`critical_path_test_api_3f2a1b9c`. `globalSetup` creates the database on first
use (so the role needs `CREATEDB`) and stamps it with `COMMENT ON DATABASE`
naming the checkout it belongs to; the readable half is `api` in every
worktree, so the stamp is how you tell two of them apart.

This exists because the opening `TRUNCATE` is fatal to a suite running beside
it. Two suites started in the _same_ checkout still share its database —
`globalSetup` takes an advisory lock and the second run refuses to start, so
run them from separate worktrees.

`pnpm run migrate:test` reaches the same database via `scripts/with-test-db.ts`.
Set `TEST_DB_NAME` to override the derivation entirely, `DB_MAINTENANCE_DATABASE`
(default `postgres`) to change where `CREATE DATABASE` is issued, and
`DB_POOL_MAX` (default 10, and 5 under vitest) to keep concurrent suites inside
`max_connections`. Every run drops databases whose stamped checkout no longer
exists; unstamped ones are never removed automatically — `pnpm run
test:db:prune --legacy` drops those.

`tests/setup/resetProcessState.ts` clears the process-global state no test owns
— the rate limiter's windows and the job runner's in-flight count — before
every file and every test. The realtime socket registry, the bus subscribers
and the job handler registry are deliberately left out: several files set those
up once per file in `beforeAll`, so clearing them per test would break those
files rather than isolate them. That is why `--sequence.shuffle.files` passes
and plain `--sequence.shuffle` does not.

### Real Redis

Two test files drive the shipped Lua and pub/sub against a real Redis, because
the shared path silently falls back to per-process state when anything about it
is wrong. They need `REDIS_TEST_URL` in `.env.test`; without it they skip and
print a notice — except on CI, where a run that cannot reach a Redis fails.

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

## Benchmarks

`bench/` seeds a large instance into a database of its own, drives the app
in-process and reports p50/p95, statement counts, time spent in Postgres and
payload size per endpoint. It runs on demand — never in CI, never as part of
`pnpm test`.

```sh
pnpm run bench
pnpm run bench:heavy
pnpm run bench --explain    # plus the plan for each scenario's slowest statement
```

`bench/README.md` covers the tiers and how to add a scenario;
`docs/scaling.md` records what the last sweep found.

## Regenerating the two clients

`web/` and `cli/` each carry a committed client built from this package's
OpenAPI and realtime documents. One command rebuilds all four files, from any
directory, and it belongs in the same commit as the schema change that moved
them:

```sh
scripts/generate-clients.sh
```

`codegen-ci.yaml` re-runs the script on a pull request and rejects one whose
committed clients are not what it produced.

## CLI (`cpath`)

`cli/` is the sibling package that builds `cpath`, a command-line client
covering this API's whole surface, `/ws` included. `cli/README.md` is its
command reference and `cli/AGENTS.md` its manual — including the one thing that
surprises people working in this package: the CLI's tests are collected by
`vitest.config.ts` here and run in `pnpm test`.

## Known limitations (v1)

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
  re-encoding (only avatars and link previews are re-encoded). A 10 MB upload
  is a 10 MB card image; there is no derived thumbnail. File safety comes from
  how downloads are served (`octet-stream`, `nosniff`, sandboxing CSP), not
  from a separate origin; the download route is the only reader of
  `task_attachment.storage_key` and is the place that has to keep that promise.
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
