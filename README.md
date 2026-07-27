# critical-path-api

TypeScript API for **Critical Path**, a project-management suite (Hono + Kysely + Postgres).

## Requirements

- Node.js >= 22
- PostgreSQL 18 running locally on `127.0.0.1:5432` (no Docker, no Supabase)

## Setup

```sh
createdb game_dev
createdb game_dev_test

cp .env.example .env        # defaults expect role `skylerberg`, no password
npm install                 # also activates the .githooks post-commit hook

npm run migrate             # migrate the dev database
npm run migrate:test        # migrate the test database
```

Create `.env.test` for the test suite:

```
DB_USER=skylerberg
DB_DATABASE=game_dev_test
STORAGE_DISK_ROOT=./data/test-uploads
ENVIRONMENT=test
```

## Development

```sh
npm run dev                 # watch mode on http://localhost:3001
npm start                   # run once
```

Swagger UI at `http://localhost:3001/api/docs`, spec at `/api/openapi.json`.
`npm run openapi:dump` writes the post-processed spec to `./openapi.json`
without starting a server.

The auth rate limiter identifies clients by socket address. When deploying
behind a reverse proxy that appends the client IP to `X-Forwarded-For`, set
`TRUST_PROXY=true` so the rightmost forwarded entry is used instead; leave it
unset otherwise, since the header is client-forgeable.

### Project members and access

Every project is shared per-project: it is visible to its creator and to the
users in its `project_member` set. The creator has implicit access and is
never stored as a member row (`member_ids` in project responses never
contains `created_by`). Ownership is transferable, and a transfer swaps the
two representations: the incoming owner's member row is deleted and the
outgoing owner gains one. Inaccessible projects return 404 everywhere (never
403), including as a copy source. Management is open: anyone with access can
manage the member set, and a member may remove themselves to leave.

- `PUT /api/projects/:id/members` (`{ user_ids: uuid[] }`, up to 100 ids)
  replaces the full member set. The creator's id is silently stripped if
  present, so clients may send naive lists; every other id must reference an
  existing user (422 otherwise). Removed members lose their task assignments
  in the project in the same transaction.
- `POST /api/projects/:id/members/by-email` (`{ email }`) adds one user by
  exact, case-insensitive email and returns `{ user }` (with `avatar_url`).
  Unknown emails return 404; adding an existing member or the creator is an
  idempotent no-op.
- `PUT /api/projects/:id/owner` (`{ user_id }`) transfers ownership and
  returns the updated project. This is the one privileged project operation:
  only the current creator may call it (other members get 403, non-accessors
  404). `user_id` must already be a member (422 otherwise), passing your own
  id is a no-op, and task assignments are untouched. Afterwards the outgoing
  creator is an ordinary member and can leave via `PUT /:id/members`.

`project.created_by` is `ON DELETE RESTRICT`, so an account cannot be deleted
while it still owns a project — ownership has to move (or the project has to
go) first. Neither being added to a project nor being handed one requires any
acceptance from the recipient, so someone given a project they do not want has
to transfer it back or delete it before they can delete their account.

Copied projects start personal: members are never copied from the source.
`GET /api/users` returns the caller plus every user sharing at least one
project with them (as creator or member on either side); `GET
/api/users?project_id=` returns the users who can access that project plus
users still assigned to its tasks or still holding a comment on them.

### Personal access tokens

A personal access token (PAT) is a named, long-lived credential for scripts and
agents, separate from the 30-day browser session and individually revocable.
Tokens carry exactly the same permissions as the user — there are no scopes —
and are accepted anywhere a session token is, including the `/ws` handshake.

- `POST /api/auth/tokens` (`{ id, name, expires_at? }`) mints one. `expires_at`
  is an ISO-8601 timestamp strictly in the future and at most 100 years out;
  omit it or send `null` for a token that never expires. The response is
  `{ token, personal_access_token }` and is the **only** time the secret is
  returned — only its sha256 hash is stored. Secrets are prefixed `cpat_`.
- `GET /api/auth/tokens` lists the caller's tokens (`{ id, name, created_at,
  expires_at }`), newest first, never the secret. Expired tokens stay listed
  until revoked so they can be seen and cleaned up.
- `DELETE /api/auth/tokens/:id` revokes one. Someone else's token id answers
  404, the same as an unknown one.

```sh
curl -X POST http://localhost:3001/api/auth/tokens \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"'"$(uuidgen | tr A-Z a-z)"'","name":"CI runner","expires_at":null}'

CRITICAL_PATH_TOKEN=cpat_… cpath board "My Project"
```

A user may hold up to 100 tokens; the next create answers 422. Changing or
resetting the password does **not** revoke personal access tokens (matching
GitHub, so unattended agents survive a rotation) — a token planted by an
attacker therefore outlives account recovery, which is why the account page
lists every token and can revoke each one. A token can also mint further tokens
— it authenticates `POST /api/auth/tokens` like any other credential — so an
`expires_at` bounds only that one secret, not the access it was granted;
revocation is the only reliable control. Revoking a token closes only the
WebSockets authenticated with that token; a password change closes only session
sockets. `POST /api/auth/logout` authenticated with a PAT is a no-op returning
204: it deletes a session row by token hash and a PAT is not one.

### Task comments

Each task carries a flat, chronological comment stream. Bodies are the same
restricted Tiptap document task descriptions use, so the allow-list, the 100 KB
cap, and the `/api/images/:id` src rule apply unchanged; a body carrying no
text, image, rule, or mention is rejected as empty. `POST /api/comments`
(`{ id, task_id, body }`) creates one; `PATCH` and `DELETE /api/comments/:id`
edit and remove **your own** only — anyone else's answers 404, the same as one
that does not exist, and there is no moderation override. Any member of the
project may comment.

`GET /api/tasks/:id` embeds the whole stream as `comments`, oldest first, and
every board task carries `comment_count` so a card can show that a
conversation exists without fetching it. Comments cascade away with their task
and with their author's account, and are not copied when a project is
duplicated via `POST /api/projects` with `source_project_id`.

### Mentions

`mention` is a node in the restricted Tiptap allow-list, so a task description
and a comment body can both name a person inline. Its attrs are
`{ id: <user uuid>, label: <1-200 chars> }` — the label is the writer's
snapshot of the name, so a rename does not rewrite stored documents and a
client is free to render the live name instead. Extra attrs are tolerated (the
editor also writes `mentionSuggestionChar`), and a mention counts as content,
so a comment reading only `@Alice` is not empty.

Writes resolve **newly added** mentions only: the document is diffed against
the one it replaces, so re-saving the same text resolves nobody, removing a
mention resolves nobody, and deleting a task or a comment resolves nobody. A
copied project keeps the mention nodes in its descriptions and resolves
nobody — copying is not writing. Recipients are the project's creator and its
members; a mention of anyone else (a chip pasted from another board, a member
removed since) is stored as written and silently skipped rather than rejected,
because a 422 would make an autosaving editor retry forever with nothing to
point at. The writer is never a recipient of their own mention, and one
request resolves at most 25 people.

**Nothing is delivered yet.** There is no notification service, so a resolved
mention is handed to a single post-commit seam in `src/services/mentions.ts`
that does nothing. Delivery (email, per-user opt-out, unsubscribe) attaches
there when the notification work lands; until then mentions are a rendering
and resolution feature only.

### Task activity

Every task carries an append-only log of what happened to it.
`GET /api/tasks/:id/activity` serves it oldest first, unpaginated, to anyone
with access to the project; an unknown or inaccessible task answers 404. Each
entry is `{ id, kind, actor_user_id, old_value, new_value, created_at }`, and
the kinds are `created`, `title_changed`, `description_changed`,
`column_changed`, `label_added`, `label_removed`, `assignee_added`,
`assignee_removed`, `blocker_added`, `blocker_removed`, `archived` and
`restored`. `old_value` / `new_value` carry `{ text }` for a title, `{ doc }`
for a description, and `{ id, name }` for a column, label, user or blocker;
both are null for archive and restore.

Entries are written inside the transaction of the mutation they record, so
they roll back with it, and only when something actually changed — re-sending
the same title, label set, assignee set or blocker writes nothing. The names in
`{ id, name }` are snapshotted at write time, so an entry still reads correctly
after the column, label or blocker task it names is renamed or deleted; a
client that wants a live name (or a label's color) can look the id up. Moving a
card within its column is not an event.

Side effects of one card's mutation are logged on the cards they change.
Deleting a column with `move_tasks_to` logs a `column_changed` on every task it
relocates. Removing a project member logs an `assignee_removed` on each task
their assignment was stripped from, attributed to the caller. Deleting a label
logs a `label_removed` on every task that carried it, and deleting a task logs a
`blocker_removed` on every task it was blocking — the deleted card's own log
goes with it, but its dependents' logs outlive it. Archiving a task is not a
blocker change: the edges survive and restoring brings them back, so only the
archived card gets an entry.

Consecutive `description_changed` entries by the same actor within five minutes
are coalesced into one entry, whose `old_value` stays the document from before
that session — editors autosave on an idle debounce, and one entry per save
would carry two whole documents each time. If the edit ends up back at the
document the entry started from, the entry is dropped rather than left recording
nothing. That coalescing is the only case where an existing entry is rewritten
or removed; nothing else updates or deletes a row.
A log cascades away with its task and with its actor's account. No realtime
event is published for activity; every mutation that writes an entry already
publishes its own event. The log starts at this release, so tasks created
earlier read as empty until they next change.

### Archived tasks

`POST /api/tasks/:id/archive` is a soft delete: it stamps `task.archived_at`
and the card leaves the board without losing anything.
`POST /api/tasks/:id/restore` clears the stamp and puts it back in the column
and position it left from, with every dependency edge intact — the
`task_dependency` rows are never touched by either call. Both are idempotent
and both return the task; archive returns it with its `archived_at`.
`GET /api/projects/:id/archived-tasks` lists a project's archive, newest
first and then in board position order, unpaginated.

An archived task behaves as if deleted, not as if done. It is absent from
`GET /api/projects/:id`, from the export, from a project copy, and from the
`open_task_count` / `done_task_count` of `GET /api/projects`. It also
disappears from the `blocker_ids` of the tasks it blocks, rather than reading
there as a satisfied blocker the way a done task does. Only
`GET /api/tasks/:id` still serves it, carrying `archived_at` so a client can
tell; on every unarchived task that field is null.

Archiving does not bump `updated_at`: the card's content did not change, and
moving the timestamp would invalidate the `expected_updated_at` precondition
of every open editor. An archived task may not be named as
`blocker_task_id` — board reads hide it, so the edge would be undisplayable
and unremovable — but a blocker may be added *to* an archived task, which is
what "restore brings the edges back" means. Cycle detection walks archived
edges, so a restore can never introduce a cycle. Deleting a column still
relocates its archived cards along with its visible ones, so archiving never
turns into an accidental hard delete.

### Bulk column actions

`POST /api/columns/:id/move-tasks` (`{ target_column_id }`) empties a column
into another one in the same project without deleting it: live tasks are
appended after the target's existing tasks keeping their relative order, and
the response is the same `{ moved_tasks }` shape `DELETE` returns. Unlike
`DELETE`, archived cards stay put — the source column survives, so the column
they were archived from still exists to restore them into.

`POST /api/columns/:id/archive-tasks` archives every live task in the column
in one statement with one `archived_at`, and answers with them in the
`GET /api/projects/:id/archived-tasks` shape and order — the whole batch ties
on that one stamp, and the tie breaks on board position, so the archive lists
the batch the same way the response did. Already archived tasks keep their
original stamp and are absent from the response, so a repeat call is a no-op
200 with an empty `tasks` array. The archived cards stay in the column, so
deleting that column afterwards still needs `move_tasks_to` even though every
board read now shows it empty. Archiving a column full of blockers is how a
whole set of dependency edges disappears at once; clients are expected to say
so before confirming.

Both emit one batched event rather than one per task — see Realtime — and
neither bumps `updated_at`.

### My tasks

`GET /api/my-tasks` is the one cross-project read of tasks: every unarchived,
unfinished task assigned to the caller, across every project they can access.
There are no path params, no query params, and no pagination — bucketing and
the person groups need the whole set to be correct.

The server files each task into one of three buckets and the client may not
re-derive them. `blocked` wins first: the task has at least one unfinished
blocker, so there is nothing to do on it yet even if it is holding three
people up. Otherwise `blocking`, which requires **another person** — a
dependent that is unassigned, or assigned only to the caller, does not count,
because the bucket means "someone else is waiting on you". Everything else is
`ready`. Tasks come back `blocking`, then `ready`, then `blocked`, and inside
a bucket by how many people are waiting (`waiting_user_ids.length`,
descending), then project name, then board column and position.

Each task carries its unfinished blockers as `blocked_by` and its unfinished
dependents as `blocking`, both with their assignees, plus `waiting_user_ids` —
the distinct other people whose unfinished work it blocks. That last one is
the authoritative "you are the bottleneck for N people" count; nothing
recomputes it. `assignee_ids` keeps the caller in it, so the payload stays
faithful and the client decides what to hide.

The two companion arrays group the same edges by person.
`waiting_on_you` comes from the dependents and `you_are_waiting_on` from the
blockers; both are built from **all** the caller's tasks, so a task filed
under `blocked` still reports the people it holds up. Only
`you_are_waiting_on` can carry a `user_id: null` group, listed last: an
unassigned blocker is real information (nothing is moving it), while an
unassigned dependent means nobody is waiting. A link assigned only to the
caller is dropped from both.

Done columns, archived tasks and **archived projects** are all excluded. The
archived-project rule is the one judgement call: an archived project is still
accessible everywhere else in the API, but archiving is the user's own "not
now" signal and this screen trades completeness for signal density. A user
whose only assignments live on an archived board therefore sees nothing, and
there is no flag to recover them.

### Public boards

`PATCH /api/projects/:id { is_public: true }` publishes a project read-only.
`GET /api/public/projects/:id/board` then serves it to anyone who knows the
project id, with no account and no token; setting `is_public` back to false
makes that route 404 again on the very next request. Any member may flip the
flag — the same authority they already have to delete the project.

Anonymous reads run through their own unauthenticated router. `is_public` is
not an arm of the project access predicate, so publishing never widens what an
authenticated handler will answer: everything else about the project stays 401
without a token and 404 for non-members. The response is shaped field by field
from the ordinary board payload, so anything added to that payload later stays
private until it is published deliberately. Public boards carry card titles,
descriptions (with their `/api/images/:id` nodes), positions, labels,
blockers, image counts, and the name and avatar of assigned users; member
ids, the creator, timestamps, and email addresses are not on the wire, and
users who are not assigned to anything are not listed at all.

Responses are `no-store` and carry `X-Robots-Tag: noindex, nofollow`. The
board itself is unlisted: nothing enumerates published projects. Anonymous
viewers get no realtime — there is no socket to authenticate and no room to
scope — so the page is a one-shot fetch.

### Per-user project ordering

Each user can order their own project list without affecting anyone else's.
`PUT /api/projects/:id/position` (`{ position: number }`, float) upserts the
caller's position for that project and returns 204; non-accessors get 404.
`GET /api/projects` returns each item's `position` (`null` when the caller
never set one) and orders by position ascending with nulls last, then
`created_at`, then `id` — so never-positioned projects keep creation order at
the end of the list. Position rows are deleted by cascade when the project is
deleted or the user's account is removed; leaving a project keeps the row,
which is harmless (the project no longer appears in the list) and restores
the old position if the user is re-added.

### Realtime

A WebSocket endpoint listens at `/ws` on the same server (not part of the
OpenAPI spec). Clients must send `{ "type": "auth", "token": "<session or
personal access token>" }` within 10 seconds of connecting, then may
`{ "type": "subscribe", "project_id" }` / `unsubscribe` to project rooms. The
server pings (`{ "type": "ping" }`) every 30 seconds and expects a `pong`;
a socket is closed with code 4401 when **its own** credential is revoked or
expires, so revoking one personal access token leaves the browser's sockets and
every other token's sockets connected.

Every mutation emits an event after its transaction commits. The envelope is
`{ type, project_id, data }`:

| type                            | data                                                 |
| ------------------------------- | ---------------------------------------------------- |
| `task_created` / `task_updated` | board task shape                                     |
| `task_deleted`                  | `{ id }`                                             |
| `task_archived`                 | board task shape plus `archived_at`                  |
| `task_restored`                 | board task shape                                     |
| `task_relations_set`            | `{ task_id, label_ids, assignee_ids, blocker_ids }`  |
| `column_created` / `column_updated` | column response shape                            |
| `column_deleted`                | `{ id, moved_tasks }`                                |
| `column_tasks_moved`            | `{ column_id, target_column_id, moved_tasks }`       |
| `column_tasks_archived`         | `{ column_id, tasks }`                               |
| `label_created` / `label_updated` | label row                                          |
| `label_deleted`                 | `{ id }`                                             |
| `image_created`                 | image response plus `{ task_id, image_count }`       |
| `image_deleted`                 | `{ task_id, image_count }`                           |
| `comment_created`               | comment row plus `{ comment_count }`                 |
| `comment_updated`               | comment row                                          |
| `comment_deleted`               | `{ id, task_id, comment_count }`                     |
| `project_created` / `project_updated` | projects-list item (with `member_ids` and task counts, without the per-user `position`) |
| `project_deleted`               | `{ id }`                                             |
| `project_position_updated`      | `{ id, position }`                                   |
| `user_updated`                  | public user `{ id, email, name, avatar_url }`        |

`task_relations_set` is emitted by the label/assignee set endpoints, blocker
add/remove, by the cascade that strips assignees when a project member is
removed, and by restore — once per live task the restored card blocks, so
their `blocker_ids` regain its id. Archiving emits no such fan-out: like
`task_deleted` it carries only the archived card, and clients strip its id
from every `blocker_ids` they hold.

`column_tasks_moved` and `column_tasks_archived` are the batched form emitted
by the two column-scoped bulk actions; the per-task `task_updated` and
`task_archived` events are **not** also emitted for those calls, because a
fifty-card Done column would otherwise cost fifty envelopes and their delivery
queries. A client that does not understand them converges on its next board
read, which every reconnect performs.

Delivery: project-scoped events go to sockets subscribed to that project whose
user can access it (re-checked per event against `created_by` and
`project_member`). `project_created` / `project_updated` are broadcast to
every authenticated socket, filtered by the same access check, so project
lists stay current without a room. Membership changes emit no dedicated event
type: users who gain or keep access receive a `project_updated` broadcast
whose payload carries the new `member_ids`, while users who lose access
receive a `project_deleted` eviction sent to a recipient list snapshotted
inside the transaction — the post-commit access re-check would exclude
exactly the users who need to hear about their removal. Project deletion
snapshots its recipients (creator plus members) the same way, since the rows
backing the access check are gone after commit.
`project_position_updated` also uses an exact recipient list — the caller
only — even though its row survives the commit: positions are per-user, so
the event exists solely to sync the caller's other devices and must never
reach other members.
`user_updated` (emitted on avatar upload/removal and on `PATCH /api/auth/me`
name/email changes, never from password or session flows) carries
`project_id: null` and is broadcast to the changed user's own sockets (their
other devices) plus every authenticated socket whose user shares at least one
project with them — creator or member on either side, re-checked live per
event with a single query over the connected users. That recipient set is
the visibility set of the global `GET /api/users` listing (the per-project mode can be broader via task assignees; those extra viewers simply do not receive live updates), which already exposes email to
project-sharers, so the event's `email` field never reaches a user who could
not already fetch it.

### Outbound webhooks

A project can register up to ten HTTP(S) endpoints that receive a signed `POST`
for every board event it emits. The vocabulary is the realtime catalogue above —
there is no second event language.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/webhooks` | Register `{ id, project_id, url }`; the response carries the generated secret |
| `GET` | `/api/webhooks?project_id=` | List a project's registrations with their secrets |
| `PATCH` | `/api/webhooks/:id` | Change `url`, or disable / re-enable with `disabled_at` |
| `DELETE` | `/api/webhooks/:id` | Remove a registration and its delivery log |
| `POST` | `/api/webhooks/:id/rotate-secret` | Replace the signing secret |
| `GET` | `/api/webhooks/:id/deliveries?limit=` | Delivery log, newest first, default 20, max 50 |
| `POST` | `/api/webhooks/:id/deliveries/:deliveryId/redeliver` | Re-send one failed delivery |

The five mutating routes above are the one deliberate exception to "every
mutation emits a realtime event": a registration is not board data, no client
caches it across sessions, and publishing one would put the signing secret on
the realtime bus and make webhooks fire about themselves. Clients load the list
when they open it.

Every request body is one envelope:

```json
{
  "id": "4d0f…",
  "version": 1,
  "type": "task_created",
  "project_id": "9b21…",
  "created_at": "2026-07-27T09:12:44.100Z",
  "data": {}
}
```

`data` is exactly the realtime `data` for that type. Headers:
`X-Critical-Path-Event`, `X-Critical-Path-Delivery` (the envelope `id`),
`X-Critical-Path-Webhook`, `X-Critical-Path-Timestamp` (unix seconds) and
`X-Critical-Path-Signature: v1=<hex>`, an HMAC-SHA256 over
`` `${timestamp}.${rawBody}` ``. Verify it against the raw body:

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

**Delivered types.** `task_created`, `task_updated`, `task_deleted`,
`task_archived`, `task_restored`, `task_relations_set`, `column_created`,
`column_updated`, `column_deleted`, `label_created`, `label_updated`,
`label_deleted`, `image_created`, `image_deleted`, `comment_created`,
`comment_updated`, `comment_deleted` and `project_updated` — which is also the
event for publishing or unpublishing a board's public link. Task activity writes
no event of its own, so it arrives as the mutation that caused it.

**Never delivered.** `user_updated` and `sessions_revoked` are not project data
and carry an email address. `project_position_updated` is per-user. No
registration can exist for a project at `project_created` time, and by
`project_deleted` the registration is already gone by cascade — that type is
also reused to evict removed members from a project that still exists, where it
would be an outright lie.

**Retries.** A non-2xx, a connection error or a 10-second timeout retries after
30s, 2m, 10m, 1h and 6h, six attempts in all. After five consecutive deliveries
exhaust their attempts the registration is disabled and its queued deliveries
are terminated; re-enabling it (`PATCH { "disabled_at": null }`) clears the
counter. Manually re-sent deliveries never count toward that threshold, so
debugging a broken receiver cannot disable the registration you are debugging.
*Redeliver* restarts the whole retry cycle under the original delivery id, so a
receiver's idempotency key still matches.

**Guarantees.** Delivery is at-least-once and unordered: a worker that dies
mid-send loses its lease and another retries, and retries plus per-webhook
batching mean two events from one request can arrive out of order. Deduplicate
on `X-Critical-Path-Delivery` and do not infer ordering. Enqueueing is
at-most-once — a pod that dies between commit and the post-commit hook drops
the event, the same guarantee the realtime publish already has.

**Fan-out.** One mutation can be many deliveries. `task_relations_set` is
published once per task, so a `PUT /api/projects/:id/members` that strips 200
assignments sends 200 requests per registration. Size receivers accordingly.

**Secrets.** The secret is stored and returned in plaintext — the server signs
with it, so it cannot be hashed like a session token. Everyone who can access
the project can read it, which means sharing a board also shares every webhook
secret on it. Rotation has a window: a delivery a worker already claimed signs
with the secret it read, so accept the previous secret briefly or tolerate one
rejected delivery that then retries under the new one.

**Target restrictions.** URLs may not carry credentials or use a scheme other
than `http`/`https`. In production `https` is required and loopback,
private, link-local, carrier-grade NAT, multicast, reserved and cloud-metadata
addresses are refused — both when the URL is registered and again after DNS
resolution at connect time, so a hostname that resolves to an internal address
is rejected rather than reached. Redirects are never followed. Outside
production those address rules are relaxed and `http` is allowed, so a
development server can point a webhook at its own machine.

**Log retention.** Terminal deliveries are kept for seven days and then pruned;
live retries are never pruned. The log has a `limit` but no cursor, so only the
50 most recent entries are reachable.

### Email

Password-reset and feedback emails go through the driver named by
`EMAIL_DRIVER`:

- `console` (default) — logs the full email; the reset link is usable from the
  server log in development.
- `ses` — sends via AWS SES v2. Requires `SES_REGION`, `SES_FROM_ADDRESS`, and
  standard AWS SDK credentials in the environment. The SDK is loaded on first
  send only.

`POST /api/feedback` (authenticated) stores user-submitted feedback in the
`feedback` table and emails it to `FEEDBACK_EMAIL_ADDRESS` (default
`criticalpath@skylerberg.com`) after the transaction commits. With
`EMAIL_DRIVER=console` (as in production today) feedback emails land in the
server logs until SES is enabled; the stored row is the source of truth either
way.

`PASSWORD_RESET_SECRET` signs reset tokens and is required in production
(development falls back to a fixed dev-only secret). `RESET_URL_BASE` sets the
link target (default `http://localhost:5173/reset-password`).

### User avatars

Each user can have one profile image:

- `POST /api/auth/me/avatar` (authenticated, multipart `file`, max 10 MB) sets
  the avatar. The upload must sniff as PNG, JPEG, GIF, or WebP by magic bytes
  and is normalized server-side: auto-oriented, downscaled to fit within
  1024x1024 (never enlarged), and re-encoded as WebP. Animated GIF/WebP uploads
  keep only their first frame. Responds with the updated user; every user-shaped
  response carries `avatar_url` (`/api/avatars/<key>` or `null`).
- `DELETE /api/auth/me/avatar` removes the avatar (idempotent) and responds with
  the updated user.
- `GET /api/avatars/:key` serves the stored WebP bytes with
  `Cache-Control: private, max-age=31536000, immutable`. Every upload mints a
  fresh storage key (the old object is deleted after the transaction commits),
  so avatar URLs never change content and can be cached forever.

### Project export

`GET /api/projects/:id/export` hands any project member everything in the
project. It is free, always available, and gated by nothing but ordinary
project access (404 for anyone else).

The default response is `application/zip`, streamed, with
`Content-Disposition: attachment; filename="<slug>-<YYYY-MM-DD>.zip"`:

```
project.json          the manifest below
tasks.csv             one row per task, for spreadsheets
images/<image-id>.png the real bytes of every attached image
```

Images ship as files, not URLs, so the archive keeps working after the account
or the storage bucket goes away. `?format=json` returns `project.json` alone —
no image bytes; fetch those from `GET /api/images/:id`, one per
`tasks[].images[].id`.

`project.json` is the stable, documented interchange format the importer reads
back:

```jsonc
{
  "format": "critical-path-project-export",
  "version": 1,
  "exported_at": "2026-07-26T12:00:00.000Z",
  "project": { "id", "name", "description", "archived_at", "created_at",
               "created_by", "member_ids", "is_public" },
  "users":   [ { "id", "email", "name" } ],
  "columns": [ { "id", "name", "position", "is_done" } ],
  "labels":  [ { "id", "name", "color" } ],
  "tasks": [ {
    "id", "column_id", "title",
    "description": "<tiptap doc or null>",
    "position", "created_at", "updated_at",
    "label_ids": [], "assignee_ids": [], "blocker_ids": [],
    "images": [ { "id", "path", "filename", "content_type", "size_bytes",
                  "created_at" } ]
  } ]
}
```

- `version` is bumped only on a breaking shape change.
- Ids are the original server ids. `created_by`, `member_ids` and
  `assignee_ids` resolve against `users[]`, `label_ids` against `labels[]`,
  `column_id` against `columns[]`, and `blocker_ids` against `tasks[]`. A
  `blocker_ids` entry that resolves to nothing is a corrupt cross-project row
  and should be dropped, exactly as project copy drops it.
- Ordering is the board's: columns and tasks by position, labels and users by
  name.
- `description` is stored verbatim, so its embedded `/api/images/<uuid>`
  sources resolve by image id against the flattened `tasks[].images[]` — build
  the id map across the whole export, not per task, and tolerate a source that
  resolves to nothing (the image may have been deleted).
- `path` is derived from the image id and its content type, never from
  `filename`, so an archive can never carry a traversal path or a name
  collision. It is emitted in both formats, though with `?format=json` it names
  a file that response does not contain.
- `images[]` lists every stored image row. If the storage object has gone
  missing the manifest still lists it, the file is left out of the archive, and
  a warning is logged.
- There is no comment model, so nothing about comments is exported.

`tasks.csv` is the human view: a UTF-8 BOM (so Excel reads non-ASCII titles),
then

```
id,title,column,is_done,position,labels,assignees,blocked_by,image_count,created_at,updated_at,description
```

one row per task in board order, RFC 4180 quoting, CRLF line endings. Labels,
assignees (as emails) and blockers (as titles) are joined with `"; "`, and the
description is flattened to plain text, mentions included as `@label`. Values
are written exactly as the user typed them — a title starting with `=` is not
prefixed or escaped, so treat a `tasks.csv` opened in a spreadsheet the same way
you would treat any other untrusted CSV. Use `project.json` when you need
exactness.

The archive is plain zip, not zip64, so a project whose images would push it
past 4 GiB answers 413 and has to be exported with `?format=json` plus one
`GET /api/images/:id` per image. With a 10 MB per-image upload cap that ceiling
is roughly 430 full-size images in one project, so it is reachable; widening the
writer to zip64 is the fix if anyone hits it.

## Database workflow

Migrations live in `src/db/migrations/` (Kysely `Migrator`, numbered
`0001_name.ts` files exporting `up`/`down`).

```sh
npm run migrate             # dev DB to latest
npm run migrate:down        # dev DB one step down
npm run migrate:test        # test DB to latest
```

After changing the schema, regenerate `src/db/types.ts` (committed):

```sh
DATABASE_URL=postgres://skylerberg@127.0.0.1:5432/game_dev npm run kysely-codegen
```

`kysely-codegen` reads the connection from the `DATABASE_URL` environment
variable — it does not use `.env`'s `DB_*` variables.

## Testing

```sh
npm test                    # full suite against game_dev_test
npm run test:watch
npm run test:coverage
```

The suite loads `.env.test`, migrates the test DB in global setup, and
truncates all tables at suite start — never point it at a database with data
you care about.

## Checks

```sh
npm run type-check
npm run lint
npm run format
```

## CLI (`cpath`)

A full command-line client lives in `cli/` as a standalone npm package
(`critical-path-cli`). It has its own lockfile and `node_modules` on purpose:
nothing about the deployed API image or the deploy workflow changes when the
CLI changes.

```sh
npm ci --prefix cli         # once; also required before running the CLI tests
cd cli && npm link          # installs the global `cpath` command
```

Authenticate — the password is prompted (or piped via `--password-stdin`) and
never stored; the 30-day session token goes into the macOS Keychain
(`security` service `critical-path-cli`), or a chmod-600 file on other
platforms:

```sh
cpath login --email you@example.com
cpath whoami
```

Everyday usage:

```sh
cpath project list
cpath board "My Project"                # columns with [ready]/[blocked] markers
cpath ready --project "My Project"      # unblocked, unfinished tasks
cpath mine                              # your tasks everywhere, ordered by who you block
cpath task create "Fix the bug" --project "My Project" --description "See **notes**"
cpath task update "Fix the bug" --project "My Project" --due 2026-08-03   # --clear-due removes it
cpath task move "Fix the bug" --project "My Project" --column "In Progress" --top
cpath task done "Fix the bug" --project "My Project"
cpath task block "Ship it" --by "Fix the bug" --project "My Project"
cpath task archive "Fix the bug" --project "My Project"
cpath column move-tasks "Done" --to "Backlog" --project "My Project"
cpath column archive-tasks "Done" --project "My Project"
cpath task archived --project "My Project" --search bug
cpath task restore "Fix the bug" --project "My Project"
cpath comment add "Fix the bug" "Reproduced on **staging**" --project "My Project"
cpath config set default-project "My Project"   # makes --project optional
cpath watch --project "My Project" | jq 'select(.type=="task_created")'
```

Entity references accept a UUID, a unique id prefix (>= 4 chars), an exact
name/title (case-insensitive), or a unique substring; ambiguity is an error
listing the candidates. Task references resolve against the board, which has
no archived cards in it, so `task archive`, `task restore`, `task show` and
`task delete` fall back to the archive on a miss; every board-shaped mutation
(`move`, `done`, `update`, `label`, `assign`, `block`) deliberately does not,
and answers `No task matching` for an archived card, by id as well as by
title. Task descriptions are Markdown in and out, converted to the API's
restricted Tiptap JSON (`--description-json` is the raw escape hatch). A due
date is one calendar day and `--due` accepts `YYYY-MM-DD` only — there is no
shorthand parsing.

Markdown is a one-way door for mentions: `task show` and `comment list` print
one as `@label`, and writing that text back with `task update --description` or
`comment edit` stores plain text, dropping the link to the person for everyone.
`--description-json` is the lossless path; comment bodies have no equivalent,
so edit one from the web app if it contains a mention.

Every command takes `--json` for machine-readable output and `--no-input` to
fail instead of prompting. Exit codes: 0 ok, 1 network/server error, 2
usage/ambiguous reference, 3 auth, 4 not found, 5 conflict, 6 invalid input.

### Watching realtime events

`cpath watch` opens the `/ws` connection described under
[Realtime](#realtime) and prints every delivered event to stdout as
newline-delimited JSON — one compact object per line, exactly the frame the
server sent, in the `{ type, project_id, data }` envelope catalogued in the
event table above. Everything else (the startup summary, connection notices,
errors) goes to stderr, so `cpath watch | jq …` is the intended shape.
`--json` and `--no-color` have no effect: the output is always NDJSON.

`--project` narrows the stream to one project. Unlike every other command it
does **not** fall back to `CRITICAL_PATH_PROJECT` or the configured
`default-project` — without the flag, `watch` follows every accessible
project, including ones created while it runs, and each line's `project_id`
disambiguates. Scoping to a project also drops the `user_updated` event,
which carries `project_id: null` and belongs to no project.

The connection reconnects on its own with exponential backoff (1s doubling to
30s) and resubscribes each time, re-listing projects first when it is
following all of them. **Reconnects are normal, not exceptional**:
production's load balancer caps a WebSocket at one hour, so a day-long
`watch` reconnects roughly two dozen times.

**There is no replay.** The server keeps no event log, so events published
while disconnected are lost — a predictable, recurring gap, not a rare
failure. `watch` is a live tap, not an event ledger; treat the "Connection
restored" line on stderr as the cue to resync with `cpath board`.

A close code of 4401 is confirmed with one HTTP request before the process
gives up, because the server also sends it for transient auth-protocol
closes. A genuinely revoked or expired session exits 3 with the usual login
hint; anything else reconnects.

### Shell completion

```sh
# zsh — into a directory on $fpath, or eval it in ~/.zshrc *after* compinit
cpath completion -s zsh > "${fpath[1]}/_cpath"        # or: eval "$(cpath completion -s zsh)"

# bash
eval "$(cpath completion -s bash)"                    # in ~/.bashrc

# fish
cpath completion -s fish > ~/.config/fish/completions/cpath.fish
```

TAB completes subcommands and flags, and — where a reference is expected —
project, column, label and task names plus member emails, taken from the
project named on the command line or, failing that, from
`CRITICAL_PATH_PROJECT` / the configured `default-project`. Those lookups are
cached for ~30 seconds under the config directory and fail silently: an
unreachable server or an expired session just means no suggestions, never an
error in the middle of your prompt.

The bash and zsh scripts are verified against bash 3.2 and zsh 5.9. **The fish
script is untested** — it was written from the documented behaviour of
`commandline` and has never been run against a real fish.

The CLI talks to the production instance
(`https://criticalpath.skylerberg.com`) by default. `CRITICAL_PATH_API_URL`
(or `--api-url`, or `cpath config set api-url`) selects another server — e.g.
`cpath config set api-url http://localhost:3001` for local development.
Tokens are stored per server URL. `CRITICAL_PATH_TOKEN` overrides the stored
token; `CRITICAL_PATH_PROJECT` sets the default project.

After changing the API surface, regenerate the CLI's committed types:

```sh
npm run openapi:dump && npm run --prefix cli generate-api
```

## Known limitations (v1)

- No email verification.
- Float `position` ordering with no automatic rebalancing.
- No per-project roles: everyone with access to a project can rename/delete
  it and manage its member set.
- `GET /api/images/:id` and `GET /api/avatars/:key` are unauthenticated
  capability URLs (unguessable UUIDs) so `<img>` tags work without auth
  headers.
- `GET /api/public/projects/:id/board` is unauthenticated and gated only by the
  project's `is_public` flag, which any member may flip. Clearing it stops the
  board being served immediately, but images embedded in card descriptions and
  the avatars of assigned users keep serving from their `/api/images/:id` and
  `/api/avatars/:key` capability URLs, so a viewer who already loaded (or
  copied) one keeps it — an avatar key is only replaced when that user uploads
  a new one, and it is the same key on every board they appear on. Anyone who
  ever held the project id can read the board the moment it is published; there
  is no separate, rotatable slug.
