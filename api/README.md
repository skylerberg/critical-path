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
outgoing owner gains one.

Each member row carries a **role**, `editor` or `viewer`, and project
responses carry a `members` array of `{ user_id, role }` alongside the older
`member_ids` (same set, same order — `member_ids` is kept only for clients
written before roles existed). The creator is implicitly an editor and has no
row. Inviting defaults to editor, so adding someone is unchanged: choosing
viewer is an explicit extra field.

- **Editors** can do everything a member could before: create, edit, move,
  archive and delete tasks, columns and labels; rename, archive, publish and
  export the board; manage members and their roles; and register webhooks.
- **Viewers** can read everything an editor can — the board, task detail,
  archived cards, activity history, the export, the member list, the webhook
  registrations, live realtime updates — and can comment, order the project in
  their own list, and leave the project. Every mutation of board content
  answers **403** `{"error":"Read-only access to this project"}`. A viewer can
  still be assigned a task and consequently cannot move their own card; that
  asymmetry is intentional.

**404 versus 403.** Inaccessible projects return 404 everywhere, including as
a copy source, so a project the caller cannot see stays indistinguishable from
one that does not exist. 403 is reserved for a caller who can already read the
row: a viewer attempting a mutation, and the two owner-only operations
(transferring ownership and deleting the project). Enforcement is central, in
`src/services/authorization.ts`, not in the clients: reads go through
`assertProjectAccess` / `assertTaskAccess` and mutations through
`assertProjectWrite` / `assertTaskWrite`. Any role value that is not exactly
`editor` is treated as a viewer, so a future third role fails closed.

- `PUT /api/projects/:id/members` (`{ user_ids?: uuid[], roles?: [{ user_id,
  role }] }`, up to 100 of each) replaces the member set, changes roles, or
  both. **Omit `user_ids` to change roles only** — that form can never add or
  remove anyone, however stale the caller's cached member list is, and it is
  what the web and CLI role controls send. A retained member with no `roles`
  entry keeps their stored role, so an old client sending only `user_ids`
  never silently promotes a viewer. The creator's id is silently stripped from
  both fields, so clients may send naive lists; every newly added id must
  reference an existing user and every `roles` entry must name someone in the
  resulting member set (422 otherwise). Removed members lose their task
  assignments in the project in the same transaction. **Editors only**, with
  one carve-out: a viewer may call it to remove themselves, and such a request
  is reduced to exactly that — every other add, removal and role change in the
  body is ignored. Any other viewer request is 403, and the role gate runs
  before the user-existence check so the endpoint cannot be used as a
  user-existence oracle.
- `POST /api/projects/:id/members/by-email` (`{ email, role? }`) shares a board
  with one exact, case-insensitive address and answers
  `{ status, role, user, invitation }`. An address that already has an account
  is added straight away (`status: "member"`, `user` populated,
  `invitation: null`, and any invitation still pending for that address on the
  board is dropped); one that does not gets a pending invitation instead
  (`status: "invited"`, `user: null`) — see
  [Pending invitations](#pending-invitations). `role` defaults to `editor`;
  omitting it on a re-invite leaves an existing member's or invitation's role
  alone, so re-inviting never silently promotes a viewer. Adding the creator is
  a no-op that stores nothing and reports `editor`. **Editors only** — a viewer
  gets 403, non-accessors 404, and the role gate runs before the address is
  looked up, so neither can use the route to learn whether an address has an
  account.
- `PUT /api/projects/:id/owner` (`{ user_id }`) transfers ownership and
  returns the updated project. Only the current creator may call it (other
  members get 403, non-accessors 404). `user_id` must already be a member (422
  otherwise), passing your own id is a no-op, and task assignments are
  untouched. Handing the project to a viewer promotes them, since the creator
  is always an editor. Afterwards the outgoing creator is an ordinary editor
  member and can leave via `PUT /:id/members`.
- `DELETE /api/projects/:id` cascades the whole board, so only the current
  creator may call it (other members get 403 and nothing is deleted,
  non-accessors get 404). A member who wants out leaves via
  `PUT /:id/members`; a creator who wants out transfers first.

`project.created_by` is `ON DELETE RESTRICT`, so an account cannot be deleted
while it still owns a project — ownership has to move (or the project has to
go) first. Neither being added to a project nor being handed one requires any
acceptance from the recipient, so someone given a project they do not want has
to transfer it back or delete it before they can delete their account.

Copied projects start personal: members are never copied from the source.
`GET /api/users` returns the caller plus every user sharing at least one
project with them (as creator or member on either side); `GET
/api/users?project_id=` returns the users who can access that project plus
users still assigned to its tasks or still holding a comment on them. Either
way a user record is `{ id, name, avatar_url }` — never an email address.

### Pending invitations

Sharing a board with an address that has no account yet stores a
`project_invitation` row and emails a link. The row is the whole lifecycle: it
grants nothing until it is claimed, it can be revoked by deleting it, and it
cascades away with either its project or the account that sent it.

An invitation is claimed in exactly two ways, and joining through either
consumes it:

- **signing up with the invited address.** Every unexpired invitation for that
  address, across every project, takes effect during signup at its invited
  role.
- **`POST /api/invitations/accept`** (`{ token }`, authenticated) with the token
  from the link. The caller need not be signed in as the invited address — an
  invitation is a grant to whoever holds the link, so someone who signs up
  under a different address can still accept.

It is deliberately **not** claimed by an existing account changing its address
to an invited one: otherwise an invitation would be a standing grant that fires
months later on an address edit. Claiming never demotes — accepting a `viewer`
invitation for a board you already edit leaves you an editor — and it sends no
"you were added to a board" mail, because the person just clicked the
invitation.

A claimer who already has access joins nothing, so the row is left alone rather
than spent: an owner opening the copy that was mailed to them, or a member
following a forwarded link, does not destroy the invitation the recipient is
still holding. The response reports the access they already had.

A claim deletes the row before it grants from it, and grants only from rows its
own delete removed, so a claim and a revoke racing each other cannot both
succeed. A revoke that gets there first wins outright — the joiner is granted
nothing rather than seated on an invitation that was already withdrawn, and
their redemption answers 422. A claim that gets there first wins instead, and
the revoke behind it answers 404. Which one wins is decided by the delete, not
by the reads either side of it.

Before any of that, a claim locks every board its invitations name — the ones it
will not join included. Every route that writes a member row takes the board
first and its invitations second, and a claim taking them the other way round
deadlocks against a revoke issued under that lock. Locking more than one board
at a time is done by id everywhere it is done at all: two lockers that disagree
about the order deadlock as soon as their sets overlap, which random ids make
about half of all pairs.

The claim locks the membership rows it reads as well. The one writer of a
member row that holds no board is the cascade behind an account deletion,
which takes only the boards its user created: their member rows on everyone
else's boards go with the account unlocked. Accepting an invitation to a board
you already belong to while your own account deletion is in flight would
otherwise be answered with the role of a row on its way out, so a share lock on
those rows is what makes the role reported to the joiner the role that was
actually stored.

- `GET /api/projects/:id/invitations` lists what is outstanding, expired rows
  included with their `expires_at` so the UI can offer resend rather than let
  them vanish. **Editors only**: the list is a management surface made entirely
  of email addresses that only editors can create, so a viewer gets 403. This
  is the one project-scoped read gated on write rather than access.
- `DELETE /api/projects/:id/invitations/:invitationId` revokes one. Every copy
  of its link dies at once, including one already in the recipient's mailbox,
  because redemption always consults the row.
- `POST /api/projects/:id/invitations/:invitationId/resend` mails it again and
  gives it a fresh 14-day deadline, which is also how an expired invitation is
  revived. **The link does not change**, so the copy the recipient already has
  keeps working. It also re-derives the stored hash, so rows left unredeemable
  by a rotation of the signing secret are repaired by a resend rather than
  needing revoke-and-reinvite.

Re-inviting an address that is already invited re-mails the identical link and
re-derives the stored hash for the same reason a resend does. It gets there by
reusing the row's id, which is also the link, so a revoke takes the board row
before it deletes: landing between the read that found the row and the insert
that recreates it would otherwise revive the very copy it was withdrawing.
Sharing with an address that has since gained an account instead drops any
invitation still pending for it, since only signup claims one: the row could
never be consumed again, while its link stayed redeemable by anyone holding it.
Pending invitations are also revoked when the account that sent them loses write
access to the board, so a demoted or removed editor cannot re-admit themselves
days later through a link they sent in advance.

Tokens are never returned by any response; the raw token exists only in the
email. It is derived by HMAC from the row id under `EMAIL_TOKEN_SECRET` rather
than stored, which is what lets a resend reproduce a link that was already sent
without persisting a usable secret. It authenticates nothing: it is not
accepted as a bearer credential and creates no session.

Limits: 100 pending invitations per project (expired ones count until revoked)
answers 422; three hourly budgets answer 429. Mailing an unproven address and
finding out whether an address has an account are separate harms, so they are
metered separately:

- **100 addresses looked up an hour, per caller**, spent by every call before
  the address is looked up. This is what bounds the rate at which this route can
  be asked about addresses, and spending it whatever the answer is what stops a
  reply about an address ever being free — a budget charged only for addresses
  with no account would leave probing for the ones that do unmetered, and would
  make the 429 itself the answer.
- **20 invitation emails an hour, per caller**, spent only where mail actually
  goes out — the invitation branch here and `/resend`, both of them after the
  per-invitation budget has passed, so a call that ends in 429 rather than an
  email costs nothing. Adding people who already have accounts is the ordinary
  way a board gets its team, and it never runs this down. What it does do, once
  it is gone, is turn away every call for the rest of the hour, an address with
  an account included: refusing only the addresses with no account is the shape
  that would make the 429 the answer.
- **3 re-mails an hour, per invitation**, covering re-inviting an address that
  is already invited as well as `/resend`, since both re-mail the identical
  link.

An invitation is a 14-day grant to whoever controls that mailbox, which is the
same trust model as adding a member by email. If the address is claimed by a
different person before it is used, that person can join the board — bounded to
one project at a known role, and bounded in time by the deadline and by
revocation.

### Sessions

Signing up or logging in creates a session row and returns its opaque token.
An account can see its own live sessions and revoke any one of them.

- `GET /api/auth/sessions` lists them (`{ id, user_agent, created_at,
  expires_at, is_current }`), newest first. `is_current` is true on the session
  the request was made with — a caller holding a personal access token therefore
  sees every session and none marked current, because a token is not a session.
- `DELETE /api/auth/sessions/:id` revokes one. Someone else's session id
  answers 404, the same as an unknown one.

A session records the `User-Agent` header of the request that created it, and
nothing else about the client. It is stored **verbatim and never parsed**: a
device name is derived from it at display time, so a header this code has never
seen costs a nice label and not a wrong record. It is truncated at 512
characters, because the header is caller-supplied and otherwise bounded only by
the HTTP server's limit. It is nullable — a client that sends no header gets
null, which the UI shows as an unknown device rather than guessing.

**No network address is recorded, here or anywhere.** An address is a location,
and turning one into a place needs geo-IP and a much larger privacy question
than a device label.

The list is complete **for sessions**, which is not the same as complete for
credentials: a personal access token authenticates exactly the same requests
and is listed by `GET /api/auth/tokens` instead. Neither endpoint on its own
shows everything that can act as the account, and any screen claiming "this is
where you are signed in" has to render both.

Sessions past their `expires_at` are omitted from the list. They authenticate
nothing, so showing them would misreport where the account is signed in; this
is the opposite of the personal-access-token list, where an expired row is a
thing the user created and still has to clean up. An expired session is deleted
the first time its own token is presented, so revoking one by id succeeds only
while the row is still there and otherwise answers 404. A client holding a
stale list should read that 404 as "already gone", not as a failure to report.

The current session may be revoked. It is a sign-out of the device making the
request — the token stops working the moment the call returns — and refusing it
would mean the "revoke everything, I have been compromised" case could not be
finished from this screen.

Revocation closes any WebSocket authenticated with that session immediately,
via a `sessions_revoked` entry naming the session (see
[Realtime](#realtime)); the socket's own 30-second credential re-check is the
backstop if that entry is ever missed.

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
project may comment, **viewers included** — commenting is the capability that
makes the viewer role worth having over an anonymous public link, so the
comment handlers deliberately assert read access rather than write access.

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

**Nothing is delivered yet.** A resolved mention is handed to a post-commit
seam that does nothing: notification email covers assignment and board
membership only, and a mention is deliberately not one of its kinds. Until that
changes, mentions are a rendering and resolution feature only.

### Task activity

Every task carries an append-only log of what happened to it.
`GET /api/tasks/:id/activity` serves it oldest first, unpaginated, to anyone
with access to the project; an unknown or inaccessible task answers 404. Each
entry is `{ id, kind, actor_user_id, old_value, new_value, created_at }`, and
the kinds are `created`, `title_changed`, `description_changed`,
`column_changed`, `due_date_changed`, `label_added`, `label_removed`,
`assignee_added`, `assignee_removed`, `blocker_added`, `blocker_removed`,
`archived` and `restored`. `old_value` / `new_value` carry `{ text }` for a
title or a due date, `{ doc }` for a description, and `{ id, name }` for a
column, label, user or blocker; both are null for archive and restore, and a
due date is null on the side where the card had none — old on the first set,
new on a clear.

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

### Card cover images

One of a task's images can be marked as the card's cover, and every board task
carries `cover_image_url` — the `/api/images/:id` URL of that image, or null.
`PUT /api/tasks/:id/cover` (`{ image_id }`) sets it and `{ image_id: null }`
clears it; the image must belong to the task, and a task has at most one cover
(a partial unique index on `task_image.is_cover`, enforced per task). It is
opt-in and off by default, so a board that never uses it is unchanged.
The choice lives on the image row itself, so deleting the image takes the
cover with it; every `image_deleted` event carries whatever cover the task has
left. Covers are copied when a project, a column or a card is duplicated, and
they are published on public boards.

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
and unremovable — but a blocker may be added _to_ an archived task, which is
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

### Duplicating a card or a column

`POST /api/tasks/:id/duplicate` (`{ id, position }`) copies one card into the
column it is already in, and `POST /api/columns/:id/duplicate`
(`{ id, position }`) copies a column plus every live card in it into the same
project. Both take a client-supplied id, so a retry cannot double-create, and
both answer 409 on an id already in use. There is no dialog of what to carry
over: a copy takes the title, description, due date, labels, assignees and
images, each image copied to its own stored object so deleting one leaves the
other intact, and the description's `/api/images/:id` srcs rewritten to point
at the copies. A copied image keeps its cover flag, so a card with a cover
duplicates into a card with the same cover. A column copy keeps each card's
position, so the cards land in the same relative order, and keeps the source's
name and done flag.

Assignees are copied, deliberately unlike a project copy, which drops them
because it also drops members: duplicating inside a project changes nothing
about the member set, so the assignee still has access.

A dependency edge is copied only when both of its ends are inside the copied
set. For a single card that means no edges at all — inheriting its "blocks"
edges would silently double every downstream dependency — and for a column it
means edges between two of its cards survive while edges leaving it do not.

A copy notifies nobody. It writes its `task_assignee` rows and its description
directly rather than through `PUT /api/tasks/:id/assignees` or `PATCH
/api/tasks/:id`, so no mention in the copied description resolves, and any
future assignment notification hung off that endpoint cannot fire for a copy
either — duplicating a card assigned to a teammate must not tell them they have
been assigned something they have never seen.

Comments and activity history are not copied; each copy's log starts with its
own `created` entry, attributed to whoever duplicated it. Archived cards are
not copied by a column duplicate, and duplicating an archived card produces a
live one — a duplicate is always a live card.

A column duplicate publishes one `column_created` plus one `task_created` per
copied card rather than a single aggregate event, so clients that already
handle creates need no new code; a 100-card column therefore publishes 101
envelopes and, for projects with webhooks, enqueues 101 deliveries per
registration.

### Bulk task create

`POST /api/tasks/batch` (`{ project_id, column_id, tasks }`) creates 1 to 100
tasks in one column of one project, for pasting a list. Every item carries an
id the client generates, plus a title and a position; descriptions, due dates,
labels and assignees are set afterwards through the single-task endpoints. The
response is `{ tasks }` in request order, in the board-task shape.

The batch is all or nothing: a duplicate id — already in the database or
repeated inside the request — is a 409 that creates none of them, so a retry
after a dropped response cannot double-create. An unknown or inaccessible
`project_id` is a 404 and a `column_id` outside that project is a 422.

Unlike the column-scoped bulk actions above, this one is **not** batched on the
way out: each created task gets its own activity entry and its own
`task_created` event, so a 100-line paste publishes 100 envelopes and, for
projects with webhooks, enqueues 100 deliveries per registration (see the
webhook fan-out note). Clients that already handle single creates need no new
code for it.

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
makes that route 404 again on the very next request. Any **editor** may flip
the flag: publishing is an ordinary edit, like renaming or archiving, and is
not owner-only the way deleting the project is. A viewer gets 403 — they can
neither publish a board nor unpublish one.

The two read-only mechanisms are independent and do not interact. A viewer's
role governs only what an authenticated caller may do; the `is_public` flag
governs only the anonymous router. Publishing a board grants a viewer nothing
extra, and demoting someone to viewer does not affect a published board. The
distinction is worth stating because the anonymous board is what a viewer
membership is an alternative to: a link is forwardable, revocable only by
unpublishing it for everyone at once, carries no identity to attribute a
comment to, and gets no realtime.

Anonymous reads run through their own unauthenticated router. `is_public` is
not an arm of the project access predicate, so publishing never widens what an
authenticated handler will answer: everything else about the project stays 401
without a token and 404 for non-members. The response is shaped field by field
from the ordinary board payload, so anything added to that payload later stays
private until it is published deliberately. Public boards carry card titles,
descriptions (with their `/api/images/:id` nodes), positions, due dates,
labels, blockers, image counts, cover images, and the name and avatar of
assigned users; member ids, the creator, and timestamps are not on the wire,
and users who are not assigned to anything are not listed at all.

Responses are `no-store` and carry `X-Robots-Tag: noindex, nofollow`. The
board itself is unlisted: nothing enumerates published projects. Anonymous
viewers get no realtime — there is no socket to authenticate and no room to
scope — so the page is a one-shot fetch.

### Search

`GET /api/search?q=` is the other cross-project read. It matches task titles and
the plain text of task descriptions, and returns a flat, relevance-ordered list
with each hit's project and column inlined. Scoping goes through the same project
access predicate as everything else, so a project the caller cannot reach simply
produces no rows — there is no 403 and no way to tell an inaccessible project
from an empty one. Archived cards and tasks in archived projects are excluded,
matching what the board and My Tasks show.

Every word in `q` must match, and each word matches as a prefix, so typing more
of a word narrows the results rather than emptying them. One case still
flickers, and it is inherent to combining prefix matching with stemming: a
partially typed inflection that has grown longer than the indexed word matches
neither arm until it is complete. A card titled "Fix the login test" matches
`test`, and again at `testing` through the stemmed arm, but not `testi` or
`testin` in between. `q` is trimmed and must be 1 to 200 characters. A single
character is a legitimate first keystroke, but it is a prefix like any other, so
it matches every card with a word starting with that letter — expect the 50-cap
and `truncated` on any real board. A query with no word characters at all
(`&&&`) is a normal 200 with no results.

Matching runs off `task.search_vector`, a stored generated column, so a result is
current the instant a task is created or edited — there is no indexer to fall
behind. It carries four arms: title and description text under the `english`
configuration at weights A and B, and the same two under `simple` at C and D.
The `simple` arms are not redundant. Prefix-matching against stemmed lexemes
alone regresses mid-word — a user typing "authentication" gets hits at "auth",
nothing from "authenti" through "authenticatio", then hits again at the full
word, because the stemmed prefix grows longer than the stemmed lexeme it should
match. The query side mirrors this: each typed token is tokenized with `simple`
and searched as its raw prefix OR its `english` prefix, so plurals and gerunds
still match and stopword prefixes like "the" never blank out. Change one side
without the other and matching silently degrades.

Descriptions are flattened out of the Tiptap JSON by jsonpath, both the text
nodes and mention labels — a card whose only reference to someone is an `@`
mention is findable by that person's name. Node type names never enter the
index. Weighting puts title hits above description hits. Results are capped at
50; `truncated` says whether more matched.

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

| type                                  | data                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `task_created` / `task_updated`       | board task shape                                                                                   |
| `task_deleted`                        | `{ id }`                                                                                           |
| `task_archived`                       | board task shape plus `archived_at`                                                                |
| `task_restored`                       | board task shape                                                                                   |
| `task_relations_set`                  | `{ task_id, label_ids, assignee_ids, blocker_ids }`                                                |
| `column_created` / `column_updated`   | column response shape                                                                              |
| `column_deleted`                      | `{ id, moved_tasks }`                                                                              |
| `column_tasks_moved`                  | `{ column_id, target_column_id, moved_tasks }`                                                     |
| `column_tasks_archived`               | `{ column_id, tasks }`                                                                             |
| `column_tasks_reordered`              | `{ column_id, moved_tasks }`                                                                       |
| `label_created` / `label_updated`     | label row                                                                                          |
| `label_deleted`                       | `{ id }`                                                                                           |
| `image_created`                       | image response plus `{ task_id, image_count }`                                                     |
| `image_deleted`                       | `{ task_id, image_count, cover_image_url }`                                                        |
| `comment_created`                     | comment row plus `{ comment_count }`                                                               |
| `comment_updated`                     | comment row                                                                                        |
| `comment_deleted`                     | `{ id, task_id, comment_count }`                                                                   |
| `project_created` / `project_updated` | projects-list item (with `member_ids`, `members` and task counts, without the per-user `position`) |
| `project_deleted`                     | `{ id }`                                                                                           |
| `project_position_updated`            | `{ id, position }`                                                                                 |
| `user_updated`                        | public user `{ id, name, avatar_url }`                                                             |
| `sessions_revoked`                    | `{ user_id }`, optionally plus `personal_access_token_id`, `session_id` or `except_session_id`      |

`task_relations_set` is emitted by the label/assignee set endpoints, blocker
add/remove, by the cascade that strips assignees when a project member is
removed, and by restore — once per live task the restored card blocks, so
their `blocker_ids` regain its id. Archiving emits no such fan-out: like
`task_deleted` it carries only the archived card, and clients strip its id
from every `blocker_ids` they hold.

`column_tasks_moved`, `column_tasks_archived` and `column_tasks_reordered` are the batched
form emitted by the column-scoped bulk actions; the per-task `task_updated` and
`task_archived` events are **not** also emitted for those calls, because a
fifty-card Done column would otherwise cost fifty envelopes and their delivery
queries. A client that does not understand them converges on its next board
read, which every reconnect performs. Batching stops there: bulk task create
has no batched counterpart and emits one `task_created` per created task, so a
100-item request produces 100 envelopes.

Delivery: project-scoped events go to sockets subscribed to that project whose
user can access it (re-checked per event against `created_by` and
`project_member`). `project_created` / `project_updated` are broadcast to
every authenticated socket, filtered by the same access check, so project
lists stay current without a room. Membership and role changes emit no dedicated
event type: users who gain or keep access receive a `project_updated`
broadcast whose payload carries the new `member_ids` and `members`, while
users who lose access receive a `project_deleted` eviction sent to a recipient
list snapshotted inside the transaction — the post-commit access re-check would exclude
exactly the users who need to hear about their removal. A demotion to viewer
keeps access, so it needs no snapshot: the broadcast plus the per-event access
re-check reaches the demoted member and is what makes an open client
re-render read-only. Project deletion
snapshots its recipients (creator plus members) the same way, since the rows
backing the access check are gone after commit.
`project_position_updated` also uses an exact recipient list — the caller
only — even though its row survives the commit: positions are per-user, so
the event exists solely to sync the caller's other devices and must never
reach other members.
`sessions_revoked` is never delivered to a client: the transport intercepts it
and closes sockets instead. A payload of `{ user_id }` closes that user's
session sockets only; one that also carries `personal_access_token_id` closes
only the sockets authenticated with that token; one carrying `session_id`
closes only the sockets of that one session; and one carrying
`except_session_id` closes the user's session sockets apart from that one. It
is published by password change, password reset, session revocation, token
revocation and account deletion — the last of which sends one user-scoped entry
plus one per token, since the user-scoped form deliberately spares live
personal access tokens. Password change is the sole publisher of
`except_session_id`: it issues a replacement session in the same transaction,
and without the exception the fan-out would close the socket that session is
about to open, which reads as an offline blip on the device that just changed
its own password.
`user_updated` (emitted on avatar upload/removal and on `PATCH /api/auth/me`
name/email changes, never from password or session flows) carries
`project_id: null` and is broadcast to the changed user's own sockets (their
other devices) plus every authenticated socket whose user shares at least one
project with them — creator or member on either side, re-checked live per
event with a single query over the connected users. That recipient set is
the visibility set of the global `GET /api/users` listing (the per-project mode can be broader via task assignees; those extra viewers simply do not receive live updates), so the event
never tells anyone about a user they could not already fetch. The payload
carries no email address: no user record does.

### Outbound webhooks

A project can register up to ten HTTP(S) endpoints that receive a signed `POST`
for every board event it emits. The vocabulary is the realtime catalogue above —
there is no second event language.

| Method   | Path                                                 | Purpose                                                                       |
| -------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST`   | `/api/webhooks`                                      | Register `{ id, project_id, url }`; the response carries the generated secret |
| `GET`    | `/api/webhooks?project_id=`                          | List a project's registrations with their secrets                             |
| `PATCH`  | `/api/webhooks/:id`                                  | Change `url`, or disable / re-enable with `disabled_at`                       |
| `DELETE` | `/api/webhooks/:id`                                  | Remove a registration and its delivery log                                    |
| `POST`   | `/api/webhooks/:id/rotate-secret`                    | Replace the signing secret                                                    |
| `GET`    | `/api/webhooks/:id/deliveries?limit=`                | Delivery log, newest first, default 20, max 50                                |
| `POST`   | `/api/webhooks/:id/deliveries/:deliveryId/redeliver` | Re-send one failed delivery                                                   |

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
_Redeliver_ restarts the whole retry cycle under the original delivery id, so a
receiver's idempotency key still matches.

**Guarantees.** Delivery is at-least-once and unordered: a worker that dies
mid-send loses its lease and another retries, and retries plus per-webhook
batching mean two events from one request can arrive out of order. Deduplicate
on `X-Critical-Path-Delivery` and do not infer ordering. Enqueueing is
at-most-once — a pod that dies between commit and the post-commit hook drops
the event, the same guarantee the realtime publish already has.

**Fan-out.** One mutation can be many deliveries. `task_relations_set` is
published once per task, so a `PUT /api/projects/:id/members` that strips 200
assignments sends 200 requests per registration; a 100-task bulk create sends
100 `task_created`. Size receivers accordingly.

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

Password-reset, email-verification, board-invitation, notification and feedback
emails all go through the driver named by `EMAIL_DRIVER`:

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

### Email verification

Every account carries `email_verified`. It starts false, turns true when the
address is confirmed, and returns to false whenever the account moves to a
different mailbox. Existing accounts were not grandfathered — the column is
nullable with no backfill, so everyone who signed up before this shipped reads
as unverified until they confirm.

Verification gates notification email and nothing else. Signing in, resetting a
password and every other route behave identically either way, and
**account-access mail always sends regardless**: the verification mail itself,
password reset, and the feedback mail to the site owner are never withheld.

A verification email is sent on signup and whenever `PATCH /api/auth/me` moves
the account to a different mailbox (a change of letter case alone sends
nothing and keeps the existing verification). The mail links to
`${APP_URL_BASE}/verify-email?token=…`; `APP_URL_BASE` is the web app's origin
and defaults to `http://localhost:5173`. The web app redeems that link on a
page open to signed-out visitors, since the usual click arrives from a mail
client on a device with no session.

Signup's send carries its own per-IP budget, on its own counter so that
spending it cannot deny anyone their own resends. Signup is unauthenticated and
its other limiter keys every bucket on the address, so without this one source
could mail an unbounded number of distinct, non-consenting addresses. It is
capped at the same ten an hour as the authenticated per-IP budget below and
deliberately not looser: this is the one that mails addresses nobody consented
to. The budget withholds only the mail — past it signup still answers `201` and
the session still starts, and the account can ask for a link from its account
page. It is deliberately not a `429`: signup denied by a shared egress IP's
exhausted budget would hand an attacker a way to keep a whole office from
registering. Nothing in the response distinguishes a withheld send from a
delivered one, so each source IP that hits the budget is logged once per window.

- `POST /api/auth/verify-email` takes `{ "token": "…" }` and answers `204`.
  It is unauthenticated and deliberately inert: the token creates no session,
  returns no user record and reveals nothing about the account, so a leaked
  link only lets its holder mark verified the very address the leak came from.
  `422 "Verification link has expired"` past the 24-hour TTL, and
  `422 "Invalid verification link"` for a tampered token, an unknown account,
  and an address the account has since moved away from — one message for all
  three, so the endpoint is not an oracle for whether an address has an
  account.
- `POST /api/auth/verify-email/resend` (authenticated, no body) mails a fresh
  link and answers `204`, or `204` without sending when the address is already
  verified. `429` past three sends an hour per account (ten an hour per IP);
  the same budget covers the send triggered by an address change, and an
  exhausted budget makes that `PATCH` answer `429` and change nothing.

Verification is idempotent. Redeeming a token twice succeeds and leaves the
recorded time untouched, a resend does not invalidate earlier links, and every
outstanding link for the same address is equivalent. Tokens are stateless
HMACs — nothing is stored and nothing needs revoking — signed with
`EMAIL_TOKEN_SECRET`, which falls back to `PASSWORD_RESET_SECRET` when unset,
so rotating the reset secret also invalidates outstanding verification links.
A token carries a hash of the address rather than the address itself, which is
both what binds it (redemption recomputes the hash from the stored address) and
what keeps addresses out of load-balancer logs and browser history.

`email` and `email_verified` are returned **only to the caller about
themselves** — the `Me` shape, used by signup, login, `GET`/`PATCH
/api/auth/me`, change-password and the avatar routes. Both are absent from the
`User` shape that describes other people, and therefore from `GET /api/users`,
project member lists, the project export manifest and the `user_updated`
realtime payload, which fans out to everyone who shares a project. No user
record discloses one person's address to another, on private boards or
anywhere else; the one place an address is on the wire between two people is a
pending invitation, which only editors may read and which exists because an
editor typed that address.

### Notification email

Two events, and only two, produce email: `task_assigned` and
`added_to_project`. Both are direct-address — somebody put your name on
something — which is why they need no digest, no batching and no per-project
mute. Everything else (mentions, unblocks, activity summaries) is deliberately
not built.

Delivery is gated per recipient in the notification layer on three conditions:
the address must be verified, the recipient must not have switched that kind
off, and the recipient must still have access to the project. The gates are
**not** in the email sender, which is what keeps account-access mail —
verification, password reset, feedback — sending unconditionally. Because they
run per recipient, one unverified, opted-out or since-evicted person on a board
never suppresses mail to the others.

The recipient list is snapshotted inside the transaction, so the access gate is
re-evaluated at send time rather than trusted from that snapshot: a member
removed between the commit and the send is never told the board's name.

Three budgets bound what any one mailbox can be made to receive, all consumed
in the same layer:

- The same notification — same person, same kind, same card or board — is sent
  at most once an hour, so redoing a membership or an assignment cannot repeat
  it. This one deliberately ignores who performed the write, or a loop would
  only have to alternate between two accounts to make every message look new.
- One **sender** may cause at most 20 notification emails an hour to any one
  recipient.
- A recipient receives at most 100 notification emails an hour across all
  senders.

The second budget is keyed on the (recipient, sender) pair, not on the
recipient alone, and that is the load-bearing part. A budget keyed on the
recipient alone is _spent by whoever causes the write_, so anyone who knows an
address can burn it — `added_to_project` needs no consent from the target and
no prior relationship. The victim then takes the spam _and_ is silenced for the
rest of the hour, losing the assignment their own team just made. Keyed on the
pair, an attacker can exhaust only their own share, and mail from everyone else
is untouched. The per-recipient ceiling above it is a backstop against a farm
of accounts, and only bites once at least five separate senders have each spent
their full share on the same person.

The alternative considered was to charge only notifications arising from
projects the recipient already belonged to. It was rejected: it leaves a
stranger's flood unbounded, which is the abuse the budget exists to stop, and
it makes the bound depend on a membership query at send time rather than on the
message itself.

A legitimate burst is unaffected. One write naming 50 people spends one message
from each of 50 separate pairs; a sprint's worth of assignments from one person
to one person fits inside 20; and a recipient hearing from ten colleagues in an
hour is nowhere near 100.

A refused message is dropped, not queued — there is no retry and no
dead-letter. The three budgets are therefore checked and charged as one atomic
step, so a message that is dropped leaves the slot the next one needs, and two
copies arriving together cannot both read a count neither has raised yet. When
counters are shared across replicas that step is a single script, not a
sequence of round trips: deciding from a value read one round trip earlier lets
everything that arrives in between pass on the same stale count, which is the
whole of the guarantee. A send that then fails gives its slots back, since no
mail exists to collapse against.

Each refusal is logged, but not once per refusal: unconditional logging would
turn a flood into log spam, and silent drops leave a silenced recipient
invisible. A sender that has spent their own share is named once an hour. A
recipient over the ceiling is the case that matters, because a farm of a
hundred accounts sending one message each reaches it with no per-sender warning
at all — so that line names the sender it refused, once per sender, for up to
ten distinct senders an hour.

Three rules bound what is sent:

- **Never the actor.** Assigning yourself a task or adding yourself to a board
  sends nothing. The rule lives in the notification layer, so every future kind
  inherits it.
- **Only additions.** Re-saving the same assignee set, changing a role,
  removing a member and transferring ownership all send nothing.
- **Copying is not writing.** Duplicating a card carries its assignees but
  notifies nobody, and neither does copying a whole board.

One write mails at most 100 people. Sends run as post-commit hooks, so a
mutation that rolls back after queuing its notification sends nothing, and a
failed send never affects the response; one recipient's failure does not stop
the sends queued behind it, and leaves a log line as its only trace.

Preferences are two booleans, both defaulting to true:

- `GET /api/auth/me/notification-settings` and
  `PUT /api/auth/me/notification-settings` (authenticated,
  `{ task_assigned, added_to_project }`). They are deliberately not part of
  `PATCH /api/auth/me`, which publishes to everyone sharing a project.

Every notification email carries an unsubscribe link and the RFC 8058 headers
`List-Unsubscribe` and `List-Unsubscribe-Post`; transactional mail carries
neither. The link holds a stateless HMAC naming one account, one kind, and a
hash of the address it was mailed to. It has **no expiry** — an unsubscribe
link has to work in a year-old email — and what makes that safe is that the
endpoints it authorizes can only switch a preference _off_. There is no request
shape that switches one on, so replay is idempotent and a leaked link is inert.
It is not a session credential: it is refused by every authenticating path.

The address hash is the one revocation that exists. Nothing else retires a
token — not a password change, not a session revocation — so moving the account
to a different mailbox is what kills every link already sent to the old one. A
link whose address no longer matches writes nothing and returns the same
response a live one does, so it is not an account-existence oracle either. The
write it skips does leave a timing difference, which is knowingly accepted:
minting a token that names an account of your choosing requires the signing
secret, so the difference separates live from dead only for a link the caller
already holds, about an account they were already mailed. The write re-asserts
the address it read rather than locking the row, so an address change
committing between the two retires the link on the way past without any
statement taking a lock that a concurrent insert naming that user would block
on.

- `POST /api/auth/unsubscribe` (`{ token }`) switches off the kind the token
  names and answers `200 { kind }` so the landing page can say what it did.
- `POST /api/auth/unsubscribe/all` (`{ token }`) switches off every kind, `204`.
  It deliberately ignores the kind the token names: it is the "stop mailing me
  entirely" button on the landing page, and refusing to write a kind the token
  does not name would make that button impossible to offer to the one person
  who is reading the message.
- `POST /api/auth/unsubscribe/one-click?token=…` is the header target. A mail
  client posts `List-Unsubscribe=One-Click` as form data, which is not JSON, so
  the token comes from the query string and the body is never read. `204`.

All three are unauthenticated and answer `422` for a tampered, unknown or
missing token — the same answer whether or not the account exists, so none of
them reveals that.

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

### Account deletion

`DELETE /api/auth/me` permanently destroys the calling account. The body is
`{ "password": "…" }` and the current password must be correct — a wrong one is
`401 { "error": "Password is incorrect" }`, the string the web client matches on
to tell a bad password apart from a dead session. There is no undo and no
grace period.

**Owned shared boards block the delete.** `project.created_by` is
`ON DELETE RESTRICT`, so an account that still owns a project with at least one
member row cannot go. The endpoint answers `409` before writing anything:

```json
{
  "error": "You still own projects that other people are members of: Team Rocket. Transfer or delete them first.",
  "blocking_projects": [{ "id": "…", "name": "Team Rocket" }]
}
```

Hand each board over with `PUT /api/projects/:id/owner` (then leave it via
`PUT /api/projects/:id/members`) or delete it, and retry. The names travel in
`blocking_projects` as well as the message so clients can link to the boards
rather than parse prose. That branch **returns** its response rather than
throwing an `AppError`, because the error handler copies every `AppError`
message into the log line; keep the guard ahead of the first write, since
returning commits the transaction.

Once the guard passes, one transaction removes: the projects the caller created
and everything inside them (columns, tasks, labels, dependencies, comments,
activity, images, webhooks and their deliveries), then the `app_user` row, which
cascades to sessions, personal access tokens, membership rows, per-user project
positions, task assignments, comments and activity entries in other people's
projects, and submitted feedback. The owned projects are deleted explicitly and
first — the `RESTRICT` constraint means the `app_user` delete would otherwise
raise `23503`.

The guard locks the caller's projects and the delete is keyed to that locked
snapshot, dropping only rows that are still memberless. It does **not** delete
by `created_by`: a concurrent `PUT /api/projects/:id/owner` can make the caller
the owner of a populated board between the guard and the delete, and a
predicate delete would destroy it and leave the `RESTRICT` with nothing to
refuse. Keyed to the snapshot, that board survives, the `app_user` delete raises
`23503`, the whole request rolls back with a `500`, and the retry gets the `409`
it should have got.

**Storage objects.** Postgres holds the only reference to a stored object, so
the keys are enumerated inside the transaction and deleted from
`postCommitHooks`: the caller's avatar plus every `task_image` in a project they
created. Images they uploaded into someone else's project are deliberately left
alone — `task_image` records no uploader, the row survives with its project, and
deleting the object would blank a picture on a live card someone else still
owns. An account's key set is unbounded, so the hook deletes in batches and
settles each one: a key that fails is logged individually, because after the
rows are gone the log line is the only trace of the orphan.

**Realtime.** Members left behind get a `project_updated` per project the
deleted user belonged to and a `task_relations_set` per task they were assigned
to, both published after the deletes so the payloads carry the post-state. The
caller's own sockets close via `sessions_revoked` — one user-scoped entry plus
one per personal access token, because the user-scoped form closes session
sockets only. The owned projects emit no `project_deleted`: by the guard they
had no members, so the caller was their only viewer.

### Project export

`GET /api/projects/:id/export` hands any project member everything in the
project. It is free, always available, and gated by nothing but ordinary
project access (404 for anyone else).

The default response is `application/zip`, streamed, with
`Content-Disposition: attachment; filename="<slug>-<YYYY-MM-DD>.zip"`:

```
project.json          the manifest below
tasks.csv             one row per task, for spreadsheets
images/<image-id>.png the real bytes of every attached image, archived
                      cards included
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
  "version": 3,
  "exported_at": "2026-07-26T12:00:00.000Z",
  "project": { "id", "name", "description", "archived_at", "created_at",
               "created_by", "member_ids", "is_public" },
  "users":   [ { "id", "name" } ],
  "columns": [ { "id", "name", "position", "is_done" } ],
  "labels":  [ { "id", "name", "color" } ],
  "tasks": [ {
    "id", "column_id", "title",
    "description": "<tiptap doc or null>",
    "position", "due_date", "created_at", "updated_at",
    "archived_at": "<ISO timestamp if the card is archived, else null>",
    "cover_image_url": "<'/api/images/:id' for the cover image, or null>",
    "label_ids": [], "assignee_ids": [], "blocker_ids": [],
    "images": [ { "id", "path", "filename", "content_type", "size_bytes",
                  "created_at" } ]
  } ]
}
```

- `version` is bumped only on a breaking shape change. It went to `2` when
  archived cards joined `tasks[]`: a reader of a `1` export could take every row
  as live, which is no longer true. It went to `3` when `users[].email` was
  dropped: no user record carries an address any more.
- Archived cards are exported. Each carries the `archived_at` that marks it and
  the `column_id` it was archived from, so an importer can restore it archived,
  drop it, or ask. A live card has `archived_at: null`. `blocker_ids` still
  omits blockers that are themselves archived, matching every other read.
- Ids are the original server ids. `created_by`, `member_ids` and
  `assignee_ids` resolve against `users[]`, `label_ids` against `labels[]`,
  `column_id` against `columns[]`, and `blocker_ids` against `tasks[]`. A
  `blocker_ids` entry that resolves to nothing is a corrupt cross-project row
  and should be dropped, exactly as project copy drops it.
- Ordering is the board's: columns and live tasks by position, labels and users
  by name. Archived cards come after every live one, newest archive first — they
  kept the position they were archived at, which a live card may since have
  taken.
- `description` is stored verbatim, so its embedded `/api/images/<uuid>`
  sources resolve by image id against the flattened `tasks[].images[]` — build
  the id map across the whole export, not per task, and tolerate a source that
  resolves to nothing (the image may have been deleted).
- `cover_image_url` takes the same `/api/images/<uuid>` form and resolves by
  image id against that task's own `images[]`. An importer restores it with
  `PUT /api/tasks/:id/cover` once the images are uploaded.
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
id,title,column,is_done,position,due_date,labels,assignees,blocked_by,image_count,created_at,updated_at,archived_at,description
```

one row per task in the manifest's order, RFC 4180 quoting, CRLF line endings.
Labels, assignees (as names) and blockers (as titles) are joined with `"; "`,
`archived_at` is empty for a live card, and the description is flattened to
plain text, mentions included as `@label`. Values
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

`cpath account delete` destroys the account for good. It re-asks for the
password and confirms before sending; `--force` skips the confirmation and is
mandatory alongside `--password-stdin`, which drains stdin and so leaves
nothing for a prompt to read. It exits 5, naming the boards, while any project
you created still has other members — `cpath project transfer` hands one over.

Everyday usage:

```sh
cpath project list
cpath board "My Project"                # columns with [ready]/[blocked] markers
cpath ready --project "My Project"      # unblocked, unfinished tasks
cpath mine                              # your tasks everywhere, ordered by who you block
cpath task create "Fix the bug" --project "My Project" --description "See **notes**"
cpath task create - --project "My Project" < titles.txt   # one card per line, max 100
cpath task update "Fix the bug" --project "My Project" --due 2026-08-03   # --clear-due removes it
cpath task move "Fix the bug" --project "My Project" --column "In Progress" --top
cpath task done "Fix the bug" --project "My Project"
cpath task block "Ship it" --by "Fix the bug" --project "My Project"
cpath task duplicate "Fix the bug" --project "My Project"
cpath task archive "Fix the bug" --project "My Project"
cpath column duplicate "In Progress" --project "My Project"
cpath column move-tasks "Done" --to "Backlog" --project "My Project"
cpath column archive-tasks "Done" --project "My Project"
cpath task archived --project "My Project" --search bug
cpath task restore "Fix the bug" --project "My Project"
cpath comment add "Fix the bug" "Reproduced on **staging**" --project "My Project"
cpath project invite "My Project" --email them@example.com --role viewer  # editor by default
cpath project invitations "My Project"  # pending invites: id, email, role, expiry
cpath project resend-invite "My Project" --id 3f9a1c2b   # id as listed, a prefix, or the address
cpath project set-role "My Project" "Their Name" --role editor   # member id or name
cpath project members "My Project"      # ROLE column reads owner / editor / viewer
cpath task url "Fix the bug" --project "My Project"   # shareable web link
cpath config set default-project "My Project"   # makes --project optional
cpath config set web-url https://criticalpath.example.com   # base for task url
cpath watch --project "My Project" | jq 'select(.type=="task_created")'
```

Entity references accept a UUID, a unique id prefix (>= 4 chars), an exact
name/title (case-insensitive), or a unique substring; ambiguity is an error
listing the candidates. Project and task references additionally accept the
22-character short alias the web app puts in its URLs; column, label,
invitation and user references do not. The alias is base64url of the id's 16
raw bytes and is **case sensitive** — one flipped letter is a different
reference, and a non-canonical spelling is rejected rather than silently
resolving to the same card. A task alias names the card outright, so it needs
no `--project`; what it does not do is let a board mutation reach an archived
card. Task references resolve against the board, which has no archived cards in
it, so `task show`, `task duplicate`, `task archive`, `task restore`, `task delete`
and `task url` fall back to the archive on a miss; every board-shaped mutation
(`move`, `done`, `update`, `label`, `assign`, `block`) deliberately does not,
and answers `No task matching` for an archived card — by alias and id just as
by title. Task descriptions are Markdown in and out, converted to the API's
restricted Tiptap JSON (`--description-json` is the raw escape hatch). A due
date is one calendar day and `--due` accepts `YYYY-MM-DD` only — there is no
shorthand parsing.

Markdown is a one-way door for mentions: `task show` and `comment list` print
one as `@label`, and writing that text back with `task update --description` or
`comment edit` stores plain text, dropping the link to the person for everyone.
`--description-json` is the lossless path; comment bodies have no equivalent,
so edit one from the web app if it contains a mention.

`cpath task url <task>` prints the card's canonical web URL — the bare URL on
stdout so it pipes into `git commit -m`, or `{ "url": ... }` under `--json`. The
base comes from `CRITICAL_PATH_WEB_URL`, then the configured `web-url`, then the
public instance. Wherever it comes from, it has to be an absolute http(s) URL
with no query, fragment or credentials — a path is appended to it, so anything
else yields a broken link, and credentials would ride along in every link
shared from it. Only the origin and path are kept.

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
project, column, label, task and member names, taken from the
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
token; `CRITICAL_PATH_PROJECT` sets the default project;
`CRITICAL_PATH_WEB_URL` (or `cpath config set web-url`) sets the base that
`cpath task url` builds links from, which is a separate setting because the web
app and the API need not share an origin.

After changing the API surface, regenerate the CLI's committed types:

```sh
npm run openapi:dump && npm run --prefix cli generate-api
```

## Known limitations (v1)

- There is no bounce or complaint handling: a hard bounce is invisible to the
  application, and nothing suppresses an address that stops accepting mail.
  Verification is the only lever, and it is what notification email is gated
  on.
- Existing accounts were never grandfathered as verified and nothing in the app
  tells them so except the account page, so they receive no notification email
  until they confirm their address there.
- `POST /api/projects/:id/members/by-email` tells an editor whether an address
  already has an account: `status` is `member` for one that does and `invited`
  for one that does not. Removing that would mean making every share an
  invitation that has to be accepted, which would end instant sharing with
  someone who already has an account. It is bounded to editors of a project and
  to 100 addresses an hour each, whatever the answer. That budget bounds this
  route, not the question: signup answers 409 to an address that is already
  taken before it has proved anything, and so does an address change, so whether
  an address has an account is learnable without a board at all. Metering those
  two is open.
- Float `position` ordering with no automatic rebalancing.
- Project roles are only `editor` and `viewer`. Every editor can rename,
  archive and publish the board and manage its member set — including demoting
  another editor, or themselves, to viewer; only the owner can transfer
  ownership or delete it. A project can never end up with no editor, since the
  creator is always one.
- A viewer can read a project's webhook registrations, signing secrets
  included, because webhook reads are gated on access rather than role. They
  cannot register, change, delete, rotate or re-send anything, but the secret
  they can read is enough to forge a delivery to that receiver.
- `GET /api/images/:id` and `GET /api/avatars/:key` are unauthenticated
  capability URLs (unguessable UUIDs) so `<img>` tags work without auth
  headers.
- Task images are stored exactly as uploaded — no resizing, no re-encoding (only
  avatars are re-encoded). A card cover therefore serves the full original, so a
  10 MB upload is a 10 MB card image; there is no derived thumbnail.
- `GET /api/public/projects/:id/board` is unauthenticated and gated only by the
  project's `is_public` flag, which any member may flip. Clearing it stops the
  board being served immediately, but images embedded in card descriptions, card
  cover images, and the avatars of assigned users keep serving from their
  `/api/images/:id` and
  `/api/avatars/:key` capability URLs, so a viewer who already loaded (or
  copied) one keeps it — an avatar key is only replaced when that user uploads
  a new one, and it is the same key on every board they appear on. Anyone who
  ever held the project id can read the board the moment it is published; there
  is no separate, rotatable slug.
- Account deletion reaches database rows and storage objects, not logs. With
  `EMAIL_DRIVER=console` the console sender writes every message it would have
  sent into the application log, so feedback submissions (name, email, user id,
  full text) and password-reset addresses and links outlive the account that
  produced them and age out with the log platform's own retention.
- Account deletion publishes no per-comment or per-activity event, so another
  member looking at a task detail keeps seeing the deleted user's comments and
  log entries (and `users` keeps their display name) until that client
  refetches or reconnects. The rows are already gone; only the open view is
  stale.
