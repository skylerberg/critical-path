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

`DB_DATABASE` here is the _base_ name: each checkout derives and creates its
own `game_dev_test_<checkout>_<hash>` from it, so parallel worktrees never
share a test database. See [Testing](#testing).

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

Account creation is capped at **50 an hour per source IP**, identified the same
way; past it `POST /api/auth/signup` answers `429` and creates nothing. Nothing
else bounds it: the auth limiter keys both of its buckets on the address being
signed up as, so every fresh address is a fresh bucket in both dimensions and
one source faces no cap at all. Without this, someone can register thousands of
addresses they do not own, and the real owner's only notice is a later
`409 Email already in use` they cannot explain. Unlike the mail budgets this
one refuses rather than withholding a side effect, because what is capped is
the account and not a message. The ceiling is far above any real shared egress
— a whole office onboarding together stays well under it — at the cost of a
theoretical denial of registration behind a NAT that sustains fifty signups an
hour.

`POST /api/auth/forgot-password` is capped at **5 an hour per source IP** and
**3 an hour per email address**, and answers `429` past either. It refuses
visibly rather than withholding the mail silently: the route already
distinguishes a registered address from an unregistered one (see [Password
change and reset](#password-change-and-reset)), so a visible throttle is no
longer an oracle for anything the route does not already answer outright.

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

`?email=` narrows either listing to the one user holding that exact address,
case-insensitively, and is how a client names somebody by address now that no
user record carries one. It is a filter over the set the same call already
returns in full, so it tells a caller nothing about anyone they could not
already list — an address belonging to a stranger, or to nobody, comes back as
an empty `users` array rather than a 404, which on this route already means the
project is missing or unreadable. A malformed address is 400. The address is
compared in SQL and the column is never selected, so it exists nowhere the
response could pick it up.

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

Every one of those writes publishes `invitations_changed`, the one event
restricted to editors, so a second editor's share panel refetches instead of
going stale. It carries no address — see [Realtime](#realtime).

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

### Password change and reset

`POST /api/auth/forgot-password` is informative: **204** when an account exists
for the address and the reset mail has been queued, **404** when none does, and
**429** past either reset budget (5 an hour per source address, 3 an hour per
email). It used to answer 204 unconditionally so the response could not reveal
whether an address was registered — but `POST /api/auth/signup` already answers
`409 Email already in use` to anyone, unauthenticated, so that property was
never actually held. All it bought was that someone who mistyped their address
waited for mail that was never coming.

Neither `POST /api/auth/change-password` nor `POST /api/auth/reset-password`
revokes anything in the `session` table: every session that was signed in
before the call is still signed in after it, including the one that made the
call. `change-password` answers 204 and issues no replacement token, because it
runs on an authenticated caller and invalidates nothing.

`reset-password` answers **200** with the same `{ token, user }` body as login
and signup, and its caller is signed in on that token. Redeeming the link
proves control of the address, which is the same proof signup takes, so the
alternative — bouncing to a login form to retype the password chosen one field
ago — buys nothing: whoever redeemed the link can log in with it regardless.
What it costs is that a forwarded or leaked reset link mints a session directly
rather than after one more form; the 15-minute expiry is what bounds that.

This is a deliberate reversal of the usual "changing your password signs you
out everywhere". That default predates the sessions list; now that a user can
see each device and revoke it individually, an all-or-nothing revoke charges
the phone and the laptop for what is usually a routine rotation. The cost is
that recovering a compromised account is two steps rather than one: reset the
password, then log in and revoke the sessions you do not recognize. The
sessions list is the only lever for that — nothing else evicts a session but
its own expiry.

What both flows *do* rotate is `app_user.alternative_id`, which is the subject
of the stateless reset-token HMAC. That makes the link that just got used
single-use and invalidates every other outstanding reset email. It has no
effect on sessions.

### The session cookie

Signup and login also set the session token as an HttpOnly `cp_session`
cookie, alongside returning it in the body. Logout clears it, and a session
that predates the cookie gains one on its next `GET` or `HEAD`, so no one has
to sign in again to acquire it. A password change leaves it alone, because it
leaves the session signed in.

It exists for one reason: a browser never attaches an `Authorization` header
to an `<img>` tag, so media routes — `/api/images/:id` and friends — cannot be
authenticated any other way without rewriting every `/api/images/<uuid>`
already embedded in a stored description. `SameSite=Lax` is the security
property rather than a default: the cookie is not sent on cross-site
subresource requests at all, so another origin cannot point an `<img>` at a
board's pictures and learn anything from whether they load. It is `Secure`
outside development, where the app and the API share `http://localhost`.

Only a session token is ever written to it. A personal access token is the
CLI's credential and putting one in a cookie would make it an ambient browser
credential; the backfill skips them, and skips unsafe methods too, because
logout manages this cookie itself and a backfill would leave the response
carrying two conflicting `Set-Cookie` headers for one name.

The media routes read it, and nothing else does — see the note on
`/api/images/:id` under [Known limitations](#known-limitations-v1). Confining it to those
routes is what keeps it from being a CSRF primitive: they are all GETs that
only read bytes, and every mutation still requires the `Authorization` header,
which no other origin can set.

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
expires_at, last_used_at }`), newest first, never the secret. Expired tokens
  stay listed until revoked so they can be seen and cleaned up.
- `DELETE /api/auth/tokens/:id` revokes one. Someone else's token id answers
  404, the same as an unknown one.

```sh
curl -X POST http://localhost:3001/api/auth/tokens \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"'"$(uuidgen | tr A-Z a-z)"'","name":"CI runner","expires_at":null}'

CRITICAL_PATH_TOKEN=cpat_… cpath board "My Project"
```

`last_used_at` is `null` until the token first authenticates and is then stamped
on every successful authentication — a REST request, a `/ws` handshake, or the
30-second heartbeat of a socket already open, so an agent that only listens
still reads as active. The write is throttled to one per token per minute and
happens on the pool rather than inside the request's transaction, so it neither
holds the token's row lock for the length of a mutation nor disappears when that
mutation rolls back. That makes the value accurate to the minute and no finer,
which is what the account page shows and all it claims.

A user may hold up to 100 tokens; the next create answers 422. Changing or
resetting the password revokes **no** credential of any kind — not tokens and
not sessions (see [Password change and
reset](#password-change-and-reset)) — so anything an attacker planted outlives
account recovery, which is why the account page lists every session and every
token and can revoke each one. A token can also mint further tokens — it
authenticates `POST /api/auth/tokens` like any other credential — so an
`expires_at` bounds only that one secret, not the access it was granted;
revocation is the only reliable control. Revoking a token closes only the
WebSockets authenticated with that token. `POST /api/auth/logout` authenticated
with a PAT is a no-op returning 204: it deletes a session row by token hash and
a PAT is not one.

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

### Card checklists

Each task carries one flat, ordered checklist. `POST /api/checklist-items`
(`{ id, task_id, text, sort_key?, checked? }`) adds an item,
`PATCH /api/checklist-items/:id` (`{ text?, checked?, sort_key? }`) ticks,
renames or repositions one, `DELETE /api/checklist-items/:id` removes it, and
`POST /api/checklist-items/:id/promote` (`{ id, sort_key? }`) turns one into a
card. There is no cap on how many items a task may carry, and no per-item
assignee, due date, label or dependency edge — the restraint is the feature; an
item that needs any of those is a card, which is what promote is for.

Unlike comments, all four assert **write** access: a checklist is card content,
not discussion, so a viewer gets 403 and a caller with no access gets 404.

Item text shares the task title's 1–2000 character limit, because promoting an
item writes its text straight into a title. Positions are floats, the same
scheme columns and tasks use, and ties break on id.

Nothing stores a count. Every board task carries `checklist_item_count` and
`checklist_done_count` as correlated subqueries computed at read time, so they
cannot drift, and `GET /api/tasks/:id` embeds the items themselves as
`checklist_items` in list order — archived cards included, which is the only
way to read an archived card's checklist.

**No checklist write touches the parent task's `updated_at`.** Bumping it would
invalidate the `expected_updated_at` precondition every open editor is holding,
so ticking a box while a teammate writes a description must not make their next
save conflict.

Promote is delete-then-insert, and that ordering is load-bearing: a second
concurrent promote blocks on the deleted row's lock, re-reads after commit,
matches nothing and answers 404 having created no card. It publishes both a
`task_created` and a `checklist_item_deleted`.

Items cascade away with their task. They **are** copied by a card duplicate, a
column duplicate and a project copy, text and ticked state verbatim under fresh
ids — a copy is a copy. They are published on public boards.

### Recurring series

A repeating commitment lives on a `task_series` row, not on a card. The row
holds the template — title, description, labels, assignees, checklist items and
destination column — plus an RRULE, the calendar day of the next occurrence and
the timezone that day is measured in. `GET /api/task-series?project_id=`,
`POST /api/task-series`, `PATCH /api/task-series/:id` and
`DELETE /api/task-series/:id` manage it. Viewers may read the list; every
mutation asserts write.

**Materialisation is lazy.** A card exists only once its occurrence is due.
Completing an instance creates nothing; a periodic background sweep does, on the
day the occurrence falls, and then advances the schedule. Nothing appears early:
there is no lead time and no way to ask for one. Each occurrence is therefore an
ordinary card with its own comments, activity and history, and it emits an
ordinary `task_created`. Editing a series changes future occurrences only — the
PATCH handler never reads or writes a `task` row.

**Expressive storage, menu-shaped interface.** The rule is stored as an RFC 5545
RRULE value and evaluated with a library, because month ends, leap years and
"last weekday of the month" are exactly where hand-rolled recurrence goes
wrong. The UI offers six presets — daily, every weekday, weekly on the start
day, monthly on the date, monthly on the nth weekday, yearly — and each maps to
a rule. There is no general RRULE editor. Two of the mappings are not the
obvious ones: `FREQ=MONTHLY;BYMONTHDAY=31` _skips_ every month without a 31st,
and `FREQ=YEARLY` from 29 February fires only in leap years, so both are stored
as `BYMONTHDAY=<d>,-1;BYSETPOS=1`, which clamps to the last day instead. A rule
that arrives outside the curated set is accepted, evaluates correctly, and
reports `preset: null` with a library-rendered `summary`; the six presets get
curated English instead, because the library renders the clamped monthly rule
as "every month on the 31st and last".

**The rule is also an attack surface**, since the API deliberately accepts
input the UI cannot produce. A submitted rule must be one line under 500
characters, carry no `RRULE:` prefix and no `DTSTART`, `TZID`, `RDATE`, `EXDATE`
or `EXRULE` (there is exactly one anchor, `start_date`, and one zone,
`timezone`), repeat no more often than daily, carry no `BYHOUR`, `BYMINUTE` or
`BYSECOND` (an occurrence is a whole calendar day, and those three together fit
inside the length cap while multiplying every search by 86,400), and keep
`INTERVAL` ≤ 366, `COUNT` ≤ 1000 and `UNTIL` before 2200. A rule that can never
fire is a 422, not a zombie row. Every occurrence search is additionally bounded
to 100 years. A project holds at most 50 series.

**Time is a calendar day in a zone.** `next_occurrence_date` says _which_
occurrence is next; `next_occurrence_at` is the precomputed instant the sweep
may create it, written as
`(next_occurrence_date::timestamp at time zone timezone)` so Postgres tzdata
does the DST arithmetic and the sweep's predicate stays sargable.

**The occurrence date is not a due date.** It decides when a card comes into
existence and nothing else. `due_date` is one more optional field on the
template, exactly like title, description, labels and assignees: set it and
every materialised card carries that value, leave it and materialised cards
have no due date, which is the default. It is never computed.

**Scheduling is forward-only.** `next_occurrence_date` only ever moves to an
occurrence after the one just materialised, or — on create, rule edit or resume
— to the first occurrence on or after today in the series timezone. A series
anchored a year in the past therefore backfills nothing.

**Catch-up skips forward and records the gap.** If the worker was down for
three days, the occurrences strictly before today are counted into
`missed_occurrence_count` and never created; retroactively spawning a week of
stale cards is the worse failure. A backlog longer than one 500-occurrence scan
is walked forward over successive sweeps rather than in one transaction.

**A due occurrence is created even when the previous one is still open**,
because silently skipping hides work that was genuinely due. The list reports
`open_occurrence_count` so the outstanding ones are visible instead.

**Idempotence has three independent layers**, so correctness does not rest on
any one of them: the runner's job lease, a per-series
`select ... for update skip locked`, and a unique index on
`(series_id, series_occurrence_date)` inserted against with
`on conflict do nothing`. The middle one is load-bearing — the job lease covers
the **job row**, and one periodic row drives every series, so it provides no
per-series exclusion at all. `do nothing` rather than a caught 23505 because a
raised unique violation would abort the transaction the schedule advance still
has to run in.

**One periodic sweep, not a job per occurrence.** An indexed table is already
the queue, and the sweep is self-healing after any edit, pause, resume or
delete with no schedule to cancel and reschedule. Each series is materialised in
its own transaction and every failure is absorbed per series into
`consecutive_failures` / `last_error`, pausing that series at five: a periodic
job row is never retired on failure, so a handler that threw would stall every
project's schedules behind its backoff.

**Three deliberate deviations from "all FKs are `ON DELETE CASCADE`".**
`task.series_id` is `SET NULL`, because cascading would delete a year of
completed invoices the moment someone stops a schedule. `task_series.column_id`
is nullable and `SET NULL`, because a column holding only series reports itself
empty and deletes with a 204 — a cascade would silently and unrecoverably
destroy the series, where nulling stops the sweep and asks for a new
destination. `task_series.created_by` is nullable and `SET NULL`, because a
series belongs to the project and not to whoever set it up: it gates nothing,
so cascading would let a member who leaves take a project's schedules with
them. A series whose creator is gone still materialises, and the card's
creation entry is attributed to the project's owner instead.

**Every series mutation emits a realtime event**, like every other mutation:
`series_created`, `series_updated` (edit, pause, resume, dismissed misses, and
the rule running out) and `series_deleted`, to the project's subscribers under
the usual per-event access re-check — viewers included, since viewers may read
the list. None of the three raises the `project_changed` dot: a schedule writes
no activity row, so a board read would report nothing changed and the dot could
never be cleared by looking at the board.

Two of them are not the CRUD routes. **Materialisation publishes
`series_updated` too**, because the same commit advances
`next_occurrence_date`, may raise `missed_occurrence_count`, may end the series
outright, and changes `open_occurrence_count` — an open panel showing the
occurrence it just consumed as still upcoming is wrong, not merely stale. So
does the per-series failure absorber, which is what surfaces `last_error` and
the pause at five without a reload. Materialisation additionally publishes a
real `task_created` for the card plus the `project_changed` dot, both naming the
series creator as the actor so the live dot and the dot a board read computes
from the activity log agree.

**Deleting a column publishes `series_updated`** for every series that pointed
at it, since the `SET NULL` above is what turns a live schedule into one asking
for a new destination. Outbound webhooks still carry none of the three: a
series is not board data, and the catalogue is a public surface.

**Copying a project copies its series**, template and all, with every
project-scoped id remapped to the copy's own columns and labels and every
assignee without access to the destination dropped — the same rule the rest of
the copy applies. The copy keeps the source's status, so an active schedule
behaves in the copy exactly as it does in the original, and its next occurrence
is recomputed from today rather than carried over, so a copy made after a missed
occurrence does not immediately fire a stale one. A _duplicated card_, by
contrast, is an ordinary card with no series link.

**A card names the schedule it came from.** `GET /api/tasks/:id` carries
`series_summary`, the same English rendering of the rule the series list shows,
so an open card can say it repeats. It is null for an ordinary card and for one
whose series has since been deleted. Board payloads deliberately do not carry
it: a join and a rule render per card, for a line one open card at a time shows.

**Rollback runbook.** If a release carrying this is rolled back, the periodic
`job` row survives with no handler anywhere. It is never claimed, but it appears
in the recurring `unregisteredKindBacklog` warning forever. Clear it with
`delete from job where kind = 'task_series_materialize';`.

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

**A resolved mention sends email.** It is the `mentioned` notification kind and
goes through the same layer as every other one — the same per-recipient gates,
the same three budgets, the same unsubscribe footer — rather than a mailer of
its own. The message names the board and the card and says which of the two
places the mention was in, because the card is the finest thing a link can
address and a comment has no URL of its own. The repeat budget is keyed on the
card, so a thread that names the same person on the same card all afternoon is
one email an hour and not one per message.

### Task activity

Every task carries an append-only log of what happened to it.
`GET /api/tasks/:id/activity` serves it oldest first, unpaginated, to anyone
with access to the project; an unknown or inaccessible task answers 404. Each
entry is `{ id, kind, actor_user_id, old_value, new_value, created_at }`, and
the kinds are `created`, `title_changed`, `description_changed`,
`column_changed`, `due_date_changed`, `label_added`, `label_removed`,
`assignee_added`, `assignee_removed`, `blocker_added`, `blocker_removed`,
`archived`, `restored`, `checklist_item_added`, `checklist_item_checked`,
`checklist_item_unchecked`, `checklist_item_renamed`, `checklist_item_removed`
and `checklist_item_promoted`. `old_value` / `new_value` carry `{ text }` for a
title, a due date or a checklist item, `{ doc }` for a description, and
`{ id, name }` for a column, label, user or blocker; both are null for archive
and restore, and a due date is null on the side where the card had none — old
on the first set, new on a clear. `checklist_item_promoted` carries the item's
text as `old_value` and the new card as `{ id, name }`.

Reordering a checklist writes no entry: a keyboard drag finalizes once per
arrow press, and logging positions would bury the card's history under one
run of a drag.

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
(a partial unique index on `task_attachment.is_cover`, scoped to image rows and
enforced per task). It is
opt-in and off by default, so a board that never uses it is unchanged.
The choice lives on the image row itself, so deleting the image takes the
cover with it; every `image_deleted` event carries whatever cover the task has
left. Covers are copied when a project, a column or a card is duplicated, and
they are published on public boards.

### Attachments

`task_attachment` holds three kinds — `file`, `link` and `image` — and is the
only place any of them lives. The separate `task_image` table it replaced is
gone.

`attachments[]` and `attachment_count` cover all three kinds. An image entry
carries `kind: "image"`, its `content_type`, `is_cover`, and an `image_url` —
the same `/api/images/:id` a description's embedded `src` uses, so one URL
serves the list thumbnail and the inline picture. `PATCH /api/attachments/:id`
renames an image like any other, and `DELETE` removes one.

There is no separate image surface left. `images[]`, `image_count`, the
`image_created` and `image_deleted` events and `POST /api/tasks/:id/images` are
all gone; a picture is uploaded, listed, renamed and deleted exactly like a
document. `GET /api/images/:id` is the one image-shaped thing that survives,
because `/api/images/<uuid>` is embedded in every description and comment body
that holds a picture and those URLs have to keep resolving.

`attachment_deleted` carries `cover_image_url`. The cover lives on the row, so
deleting one can clear it, and this is now the only event that says an
attachment went away.

**Which kind an upload becomes is the server's decision.**
`POST /api/attachments/files` reads the first twelve bytes: PNG, JPEG, GIF or
WebP under 10 MB becomes `kind: "image"`, anything else `kind: "file"` under the
50 MB cap. The declared `content_type` never decides — it is recorded for display
on a file and ignored entirely on an image. That keeps the rule in one place
rather than in every client, and means a `.bin` that is really a PNG is stored as
one while an SVG, which no sniffer here recognizes, stays a file and is served as
an opaque download.

A file attachment stays unreachable through `/api/images/:id`, and an image
through `/api/attachments/:id/download`, `/preview` and `/favicon`.

An image row carries `image_storage_key` and `image_content_type` rather than
sharing `storage_key` and `content_type` with files. That is what keeps
`GET /api/images/:id` — unauthenticated, and the one route that echoes a stored
content type — structurally unable to reach a document's bytes: it selects only
those two columns, and a file row has both null. The type is CHECK-restricted to
the four formats magic-byte sniffing produces, so no repair query can leave a row
it would serve as something renderable. The route also sends
`X-Content-Type-Options: nosniff`: a file can be a valid GIF _and_ valid HTML at
once, and the header is what stops a browser looking past the declared type and
rendering the other half as a document on our own origin.

| Route                               | Auth   |
| ----------------------------------- | ------ |
| `POST /api/attachments/files`       | bearer |
| `POST /api/attachments/links`       | bearer |
| `PATCH /api/attachments/:id`        | bearer |
| `DELETE /api/attachments/:id`       | bearer |
| `GET /api/attachments/:id/download` | bearer |
| `GET /api/attachments/:id/preview`  | none   |
| `GET /api/attachments/:id/favicon`  | none   |

**Files of any type.** `POST /api/attachments/files` takes the file's raw
bytes as the whole request body; `task_id`, `filename`, the declared
`content_type` and an optional client-supplied `id` travel as query
parameters. The body is never assembled in memory: it is piped straight to
storage as it arrives, and the byte cap is applied to the stream rather than
to a finished buffer, so an upload that exceeds it is cut off mid-transfer and
the partial object is reclaimed. That is what makes a 50 MB cap affordable —
concurrent uploads cost a chunk of memory each, not a whole file each. It also
means a request with no `Content-Length` is bounded exactly like one that
declares it. A malformed query parameter is a 400, an empty body a 422.
Nothing is sniffed and nothing is normalized — a PDF cannot be re-encoded
away, so the safety of an arbitrary upload comes from how it is served rather
than from what it is.
`content_type` records the sanitised _declared_ MIME type; it drives the UI
glyph and the label and **is never written to a response header**. `filename`
is likewise sanitised at upload and is immutable: `PATCH` writes `title`, the
display label, so a rename can never change what a download saves as.

`GET /api/attachments/:id/download` always answers
`Content-Type: application/octet-stream` with
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and
`Content-Security-Policy: default-src 'none'; sandbox`, whatever the file is.
There is no code path that serves user-uploaded bytes with a renderable
content type, so an uploaded `.svg` or `.html` downloads rather than executing.
Unlike `GET /api/images/:id` this route is authenticated and answers 404 to a
caller without project access, so removing someone from a project takes their
access to its documents with it. A viewer may download; only an editor may
attach, rename or delete.

**Limits.** `ATTACHMENT_MAX_BYTES` (50 MB by default) caps one file, and
`PROJECT_STORAGE_QUOTA_BYTES` (1 GiB by default) caps a whole project. The
project quota sums every `task_attachment` row, images included, so it applies
to image uploads too — a project already over quota cannot upload again until
it deletes something. A task holds at most 50 attachments. Whichever of
the two byte limits bites first is the one the upload stream is cut at, so a
project with 3 MB of quota left refuses a 50 MB file after 3 MB rather than
after 50; the exact, serialized quota check still runs once the size is known
and before the row commits, and the object it refuses is reclaimed.

**On the card.** Every board task carries `attachment_count` — all three kinds
together — so a card can show a paperclip without fetching the list.
`attachment_created` and `attachment_deleted` carry the new count for the same
reason `comment_created` does, and an image mutation now publishes both its
`image_*` event and the matching `attachment_*` one so a browser holding either
vocabulary stays current.

**Public boards publish attachments too**, all three kinds, with an
`attachments[]` array alongside `comments[]` and `checklist_items[]` and an
`attachment_count` on every card. Publishing a board publishes what is on its
cards; leaving files out would have meant an image on a public card was readable
by anyone while a PDF beside it was not — one list, two rules.

That makes `GET /api/attachments/:id/download` the first route with _optional_
auth rather than none or all: it reads a token when one is offered, serves a
stranger only when the board is published, and still answers 404 to an account
with no membership on one that is not. A missing token on a private board is a
401 rather than a 404, because a token might have earned access and 404 would be
an answer the caller could not act on. `optionalAuth` is pinned by
`assertPublicRoutes` the same way `skipAuth` is, and for the same reason: the
marker is one line and its effect is invisible until someone reaches the
resource without credentials.

**Links.** `POST /api/attachments/links` stores the URL and answers 201
immediately with `unfurl_state: "pending"`; adding never waits on the network.
Only `http`/`https` URLs without embedded credentials are stored, and at most
2048 characters. A background `attachment_unfurl` job then fetches the page and
fills in `title`, `description`, a preview image and a favicon, publishing
`attachment_updated` when it settles. Both images are re-fetched into our own
storage and re-encoded to WebP rather than hotlinked, so rendering a card leaks
no viewer's IP to a third party and does not break when they move the file.
They are served under the same rule as images, because they go in an `<img>`:
project access, or a published board. Each of those two routes selects only its
own key column, so neither can serve a document's bytes whatever id is
guessed.

Unfurling is best-effort by design: a target that refuses unfurlers, times out,
answers a non-HTML body or resolves to a blocked address settles the row at
`failed` with the URL intact, and the user supplies a title by hand. There is
no refresh and no manual re-unfurl — a user-triggered, repeatable server-side
fetch of an attacker-chosen URL is exactly what the SSRF budget is there to
prevent. Attaching a link is rate limited to 60 an hour per user.

The unfurl fetcher reuses the webhook sender's target rules verbatim: private,
loopback, link-local and reserved ranges are blocked (including
`169.254.169.254`), the vetted address is pinned to the socket so DNS rebinding
cannot switch it, every redirect hop is re-validated rather than only the first
URL, at most three redirects are followed, responses are capped (512 KB of HTML,
2 MB of preview image, 256 KB of favicon), `Accept-Encoding: identity` makes a
compression bomb structurally impossible, and one absolute deadline covers the
whole chain so a target trickling one byte a second still settles. `http://` is
allowed even in production: the blocklist, not TLS, is the defense, and
refusing a pasted `http://` link would help nobody.

Storing a link and fetching it are separate decisions. A URL pointing at a
private host is stored — recording `http://wiki.internal/spec` is legitimate —
and its job is still enqueued; the job is what refuses to fetch it.

**Lifecycle.** Rows cascade from the task, so task, project and account
deletion take them; the stored objects are reclaimed after commit. Duplicating
a card, a column or a project copies both kinds, with fresh ids and freshly
copied storage objects, and a copied link keeps the metadata it already has
rather than being re-fetched. The export archive carries file bytes under
`attachments/<id>.<ext>` and lists both kinds in `tasks[].attachments[]`.

### Archived tasks

`POST /api/tasks/:id/archive` is a soft delete: it stamps `task.archived_at`
and the card leaves the board without losing anything.
`POST /api/tasks/:id/restore` clears the stamp and puts it back in the column
and position it left from, with every dependency edge intact — the
`task_dependency` rows are never touched by either call. Both are idempotent
and both return the task; archive returns it with its `archived_at`.
`GET /api/projects/:id/archived-tasks` lists a project's archive, newest
first and then in board position order, unpaginated.

Archiving is the only way to get to a hard delete. `DELETE /api/tasks/:id`
refuses a task that is still on the board with a 422 and deletes only one whose
`archived_at` is set, so losing a card takes two deliberate steps with a
reversible one in between; the check holds a row lock, so a concurrent restore
cannot slip a live card past it. Clients enforce it too, but the endpoint is
where the rule actually lives.

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

### Cross-project dependencies

A `task_dependency` edge may join tasks in two different projects. Adding one
needs write access to the **blocked** task's project and read access to the
blocker's — GitLab's access-to-both rule. A `blocker_task_id` that names no task
and one that names a task in a project the caller cannot read get the same 422,
so the route can never be used to test whether an id is real. Removing an edge
needs write on the blocked side only: the far end can become unreadable, and the
side that carries the edge must always be able to detach it.

**The board pays for this with one number, not a join.** `blocker_ids` holds
same-project blockers only, which is what lets any client resolve every id in it
against the board payload it already has. A blocker in another project is never
named there. It arrives as one increment of `open_cross_project_blocker_count`,
a denormalised count of the caller's cross-project blockers that are unarchived
and not in a done column. A cross-project blocker therefore counts as exactly
one blocker and is never expanded into whatever is blocking *it*: depth stops at
the project boundary, and a board read never touches another project's rows.

The count is maintained in application code, in the same transaction as the
change that moves it — completion, a move into or out of a done column, a column
having its done flag flipped, archive, restore, delete, edge add and remove, and
the cascade behind a project or account deletion. That is not a shortcut around
a database trigger: every one of those sites has to publish
`cross_project_blockers_changed` into the *other* project so its boards update
live, so the affected dependents are enumerated in application code regardless.
The recompute is absolute rather than incremental, so a count that ever drifts
heals the next time anything touches its blocker.

`cross_project_blockers_changed` is its own event type rather than a
`task_relations_set` fan-out because it lands on a project whose members may have
no access to the card that moved: it carries only the recount, reaches no webhook
registration, and raises no unseen-changes dot, since the change writes no
activity or comment row there and the dot could never be cleared.

**Identity is fetched separately, or not at all.**
`GET /api/tasks/:id/cross-project-dependencies` serves the edges themselves,
lazily, in both directions — `blocked_by` and `blocking`, the latter having no
other surface anywhere, so nothing else would warn you that finishing a card
matters to another board. Each entry carries the remote title, project and done
state. An edge whose other end is in a project the caller cannot read is **not
listed at all**; it is added to `hidden_blocked_by_count` or
`hidden_blocking_count` instead. There is no field on the entry shape that could
hold a redacted value, so no later change can populate one by accident. Those
counts cover open edges only, which makes them reconcile exactly with
`open_cross_project_blocker_count` and stops a caller subtracting the two to
learn that a task they cannot see has been finished.

Public boards deliberately omit the count. It is a live measurement of a project
that never agreed to be published, and a stranger watching it fall would learn
that another team finished something; the price is that a card blocked only from
another project reads there as ready.

A cycle may now leave a project and come back, so cycle detection walks every
edge regardless of project — it always did — and the 409's `cycle` path walks the
reachable subgraph rather than one project's slice. A step in a project the
caller cannot read comes back as `{ id: null, title: null }`: the loop keeps its
length and shape, so it still reads as a closed loop, while naming nothing.

Project copy still drops an edge whose other end is outside the copied set,
which now includes another project: a copy stays self-contained rather than
landing pre-blocked by work it does not own.

There is no UI for creating a cross-project edge yet. The API and `cpath` are the
only ways in, deliberately, until there is a reason to expose it.

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
on that one stamp, and the tie breaks on sort key, so the archive lists
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

`POST /api/tasks/:id/duplicate` (`{ id, sort_key? }`) copies one card into the
column it is already in, and `POST /api/columns/:id/duplicate`
(`{ id, sort_key? }`) copies a column plus every live card in it into the same
project. Both take a client-supplied id, so a retry cannot double-create, and
both answer 409 on an id already in use. There is no dialog of what to carry
over: a copy takes the title, description, due date, labels, assignees,
checklist items (text and ticked state alike) and images, each image copied to
its own stored object so deleting one leaves the other intact, and the
description's `/api/images/:id` srcs rewritten to point at the copies. A copied
image keeps its cover flag, so a card with a cover duplicates into a card with
the same cover. A column copy keeps each card's sort key — they are unique per
column and the copy's column is new — so the cards land in the same relative
order, and keeps the source's name and done flag. A card duplicated into the
column it came from cannot keep its key, and is ranked after it instead.

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

### How many cards a project holds

A project holds at most **5,000 tasks** (`MAX_TASKS_PER_PROJECT` in
`src/config/constants.ts`). Every path that creates one enforces it and answers
**422** past it: single create, `POST /api/tasks/batch`, a card duplicate, a
column duplicate, promoting a checklist item, and a project copy — whose ceiling
applies to the live cards the source would contribute, since the destination
starts empty. Nothing else changes: an existing project over the cap reads,
edits, archives, moves and exports exactly as before, and only creating a new
card is refused.

**Archived cards count.** They hold rows and sort keys just like live ones, so
exempting them would leave the ceiling unbounded to anyone archiving as they go.

The cap is a denial-of-service guard, not an invariant. The single-create path
deliberately takes **no lock** on the project row, unlike the webhook and series
caps: those gate a rare operation, while this gates the hottest write in the
product, and serializing every card a board creates behind one row lock would
cost far more than the overshoot it prevents. Concurrent creates may therefore
land a handful of rows past the ceiling. The copy and duplicate paths do lock,
because they are rare, already expensive, and each adds thousands of rows at
once; the lock excludes other bulk copies of the same project rather than
concurrent single creates.

Before the cap, a project of ~9,300 cards broke the copy outright: the task
insert bound seven parameters per row in one unchunked statement and Postgres
caps a statement at 65,535, so the copy answered 500 rather than refusing.
`src/services/projectCopy.ts` now writes tasks, task labels, assignees,
dependencies and checklist items in `BULK_INSERT_CHUNK` batches like the
checklist rows always did.

**The recurring sweep at the ceiling.** A full board makes materialisation fail
rather than silently create nothing: the occurrence batch is refused whole — a
partial fill would advance the schedule past the rest and drop cards with no
trace — and the throw goes through the machinery the series already has. The
reason lands in `last_error`, `consecutive_failures` climbs, and after
`MAX_CONSECUTIVE_FAILURES` sweeps of a board that stayed full the series parks
in `paused` with `next_occurrence_at` cleared. Until then it keeps retrying, so
a board pruned back under the cap resumes on its own.

### Bulk task create

`POST /api/tasks/batch` (`{ project_id, column_id, tasks }`) creates 1 to 100
tasks in one column of one project, for pasting a list. Every item carries an
id the client generates, plus a title and an optional sort key; descriptions, due dates,
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

### Bulk actions on a selection

Four routes act on an arbitrary set of a project's cards — the set a client
builds by multi-selecting on the board — in one request and one transaction:

| route                            | body                                                          | 200                                 |
| -------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `POST /api/tasks/bulk-move`      | `{ project_id, task_ids, column_id }`                         | `{ moved_tasks, skipped_task_ids }` |
| `POST /api/tasks/bulk-archive`   | `{ project_id, task_ids }`                                    | `{ tasks, skipped_task_ids }`       |
| `POST /api/tasks/bulk-labels`    | `{ project_id, task_ids, add_label_ids?, remove_label_ids? }` | `{ tasks, skipped_task_ids }`       |
| `POST /api/tasks/bulk-assignees` | `{ project_id, task_ids, add_user_ids?, remove_user_ids? }`   | `{ tasks, skipped_task_ids }`       |

There is deliberately no bulk delete. Deletion is only ever reachable from the
archive, one card at a time, so a multi-select can never destroy anything in one
action; a bulk archive is the reversible equivalent.

Every body names its project and that access is asserted once for the whole
batch, not per card: a per-card assertion would be two queries per id and would
404 the entire request on one foreign id. `task_ids` holds 1 to 100 ids;
duplicates are applied once and anything outside that range is a 422.

**Nothing fails wholesale.** Ids that are unknown, that belong to another
project, or that the specific action cannot touch come back in
`skipped_task_ids` and the rest of the batch still commits — a teammate deleting
one selected card must not cost the caller the other nineteen. An id in another
project is never distinguishable from an unknown one, which is what stops the
skip list becoming a cross-project existence oracle.

Move and archive skip archived cards: an archived card has no board position,
and restore is contracted to return it to the column it was archived from. The
two delta routes do not skip them — an archived row is still exactly the card
the user selected, and reporting a skip they cannot act on helps nobody.

Move appends after the target column's existing cards in the order the ids were
sent, so the client decides where the selection lands. The read of the target's
greatest sort key spans archived rows, so a relocated card never collides with
one — an archived card holds its slot against the unique index. A card already in the target is re-stamped, so the selection lands
contiguous, but keeps its `column_since` and writes no `column_changed` entry;
every other card logs a move naming **its own** source column, which is why the
column-wide relocate cannot be reused here. A `column_id` outside the project is
a 422 even when every task id was skipped.

Archive shares one `archived_at` across the batch, exactly like the column-wide
archive, so the archive view's tie-break on sort key and then id interleaves the
columns of a selection that spans several. Already-archived ids keep their
original stamp, so a repeat call is a no-op 200.

Labels and assignees are **deltas, not replaces**. A selection rarely shares a
label set, so replacing one from a client snapshot would strip every label the
cards did not have in common and would multiply the lost-update window by the
size of the selection. At least one of the two arrays must be non-empty and they
must not overlap; both are 422. Added ids are validated against the project
(labels) or against project access (users); removed ids are not, because
removing a row that is not there is a no-op. A card the call applied to but did
not change — it already carried the label — appears in neither the response nor
the activity log; that is a no-op, not a skip. The cards that did change come
back in `task_ids` order, so a client can zip the response against the
selection it sent.

A bulk assignment sends no per-card email. The repeat suppression that keeps
assignment mail sane is keyed per task, so twenty cards are twenty distinct
budgets and one click would send twenty emails to each added user. Each added
user gets one coalesced `bulk_task_assigned` digest instead — see "The bulk
assignment digest". A copy still notifies nobody at all.

Each route emits exactly one event and no per-task events — see Realtime — and
none of them is a webhook event.

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
descending), then project name, then board column and sort key.

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

Both link arrays are filtered to projects the caller can read, because a link
carries a title, a project id and its assignees and an edge may now cross into a
project they have no relation to. What is filtered out is reported as
`hidden_blocked_by_count` and `hidden_blocking_count`, over open edges only. A
hidden blocker still files the task as `blocked` — the alternative is calling
unstartable work ready. A hidden dependent does the opposite and never moves a
task into `blocking`, which means "someone else is waiting on you" and cannot be
claimed about a person who may not be named. Hidden links appear in neither
person group, and in particular never in the `user_id: null` group: that group
means "unassigned, nothing is moving it", which is a stronger claim than
"unknown".

Done columns, archived tasks and **archived projects** are all excluded. The
archived-project rule is the one judgment call: an archived project is still
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
labels, blockers, image counts, cover images, checklist items with their counts,
and the name and avatar of assigned users; member ids, the creator, and
timestamps are not on the wire, and users who are not assigned to anything are
not listed at all. Checklist items are scoped to the published tasks, so an
archived card's items stay off a public board along with the card.

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
`PUT /api/projects/:id/position` (`{ sort_key }`) upserts the caller's rank for
that project and returns 204; non-accessors get 404. `GET /api/projects`
returns each item's `sort_key` (`null` when the caller never set one) and orders
by it ascending with nulls last, then `created_at`, then `id` — so never-ranked
projects keep creation order at the end of the list. Rank rows are deleted by
cascade when the project is deleted or the user's account is removed; leaving a
project keeps the row, which is harmless (the project no longer appears in the
list) and restores the old rank if the user is re-added.

### What changed since you last looked

`PUT /api/projects/:id/seen` moves the caller's marker for a project to now and
returns 204. It is the only thing that moves it: a board read, an export, a CLI
listing or a webhook delivery never does, so nothing a script reads can clear
somebody's dot. Any member may call it, viewers included — a marker only that
user can see is not a write to the board — and non-accessors get 404. Archiving
does not stop it.

Two reads are answered from that marker, and both mean the same thing by
"changed": a live card in the project carrying a `task_activity` or
`task_comment` row written by somebody else, after the marker.
`GET /api/projects` returns `last_seen_at` (null until the caller has ever
opened the board) and `has_unseen_changes`; `GET /api/projects/:id` and
`POST /api/projects` return `changed_task_ids`, the ids in that same payload
that qualify.

With no marker the comparison is against null, so a board the caller has never
opened reports no unseen changes and highlights nothing, rather than everything
since the beginning of time. `has_unseen_changes` is additionally false for an
archived project: a dot asks to be looked at, and an archived board is one the
user has put away. `changed_task_ids` is not, so opening an archived board
still shows what moved in it.

Both silences below are deliberate, and both lose a highlight rather than
inventing one. Activity and comments cascade with their task, so a deleted or
archived card leaves nothing to notice. And `created_at` defaults to
transaction start, so a bulk write that began before a stamp and commits after
it sorts below the marker and is seen forever.

Removing a member deletes their marker for that project, unlike their position
row: a marker is a claim about what they have read, and re-adding them later
should not silently carry one from before they were removed.

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
`{ type, project_id, data }`. The table below summarizes each payload; the
machine-readable version is served at `GET /api/realtime-events.json`, generated
from the same declarations the server publishes against, so a client can generate
types for the envelope instead of asserting shapes off the wire. `project_id` is
a string for every event except the three account-scoped ones, where it is `null`.

Every board mutation's `data` also carries `actor_user_id` — the user whose
request made the change, or `null` when a schedule or a background job did. It is
what lets a client tell a teammate's change from an echo of its own, so the actor
is sent their own events rather than being withheld them. The project-list,
per-user, invitation, series and account events carry none; the table below lists
the rest of each payload, and `realtime-events.json` is the per-type answer.

| type                                                | data                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `task_created` / `task_updated`                     | board task shape                                                                                   |
| `task_deleted`                                      | `{ id }`                                                                                           |
| `task_archived`                                     | board task shape plus `archived_at`                                                                |
| `task_restored`                                     | board task shape                                                                                   |
| `task_relations_set`                                | `{ task_id, label_ids, assignee_ids, blocker_ids, open_cross_project_blocker_count }`              |
| `cross_project_blockers_changed`                    | `{ tasks }`, each `{ task_id, open_cross_project_blocker_count }`                                   |
| `column_created` / `column_updated`                 | column response shape                                                                              |
| `column_deleted`                                    | `{ id, moved_tasks }`                                                                              |
| `column_tasks_moved`                                | `{ column_id, target_column_id, moved_tasks }`                                                     |
| `column_tasks_archived`                             | `{ column_id, tasks }`                                                                             |
| `column_tasks_reordered`                            | `{ column_id, moved_tasks }`                                                                       |
| `bulk_tasks_moved`                                  | `{ moved_tasks }`                                                                                  |
| `bulk_tasks_archived`                               | `{ tasks }`                                                                                        |
| `bulk_tasks_relations_set`                          | `{ tasks }`, each `{ task_id, label_ids, assignee_ids, blocker_ids, open_cross_project_blocker_count }` |
| `label_created` / `label_updated`                   | label row                                                                                          |
| `label_deleted`                                     | `{ id }`                                                                                           |
| `attachment_created`                                | attachment response plus `{ attachment_count }`                                                    |
| `attachment_updated`                                | attachment response shape                                                                          |
| `attachment_deleted`                                | `{ id, task_id, attachment_count, cover_image_url }`                                               |
| `comment_created`                                   | comment row plus `{ comment_count }`                                                               |
| `comment_updated`                                   | comment row                                                                                        |
| `comment_deleted`                                   | `{ id, task_id, comment_count }`                                                                   |
| `checklist_item_created` / `checklist_item_updated` | checklist item row plus both counts                                                                |
| `checklist_item_deleted`                            | `{ id, task_id, checklist_item_count, checklist_done_count }`                                      |
| `series_created` / `series_updated`                 | recurring series shape                                                                             |
| `series_deleted`                                    | `{ id }`                                                                                           |
| `project_created` / `project_updated`               | projects-list item (with `member_ids`, `members` and task counts, without the per-user `sort_key`) |
| `project_deleted`                                   | `{ id }`                                                                                           |
| `project_position_updated`                          | `{ id, sort_key }`                                                                                 |
| `project_seen`                                      | `{ id }`                                                                                           |
| `project_changed`                                   | `{ id, actor_user_id }`                                                                            |
| `invitations_changed`                               | `{ project_id }`                                                                                   |
| `user_updated`                                      | public user `{ id, name, avatar_url }`                                                             |
| `sessions_revoked`                                  | `{ user_id }`, optionally plus `personal_access_token_id` or `session_id`                          |
| `account_updated`                                   | caller's own `{ id, name, avatar_url, email, email_verified }`                                     |

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
read, which every reconnect performs. The three `bulk_tasks_*` types are the
same idea for a selection rather than a whole column, and follow the same rule:
one envelope per call, and no per-task `task_updated`, `task_archived` or
`task_relations_set` alongside it. `bulk_tasks_relations_set`
carries only the cards the call actually changed, so a card that already had the
label is absent from it. Batching stops there: bulk task create has no batched
counterpart and emits one `task_created` per created task, so a 100-item request
produces 100 envelopes.

None of the `bulk_tasks_*` types are webhook events, for the same reason the
`column_tasks_*` types are not: a webhook consumer subscribes to per-card
changes, and a batched envelope would hand it a payload it has no schema for.

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
`project_position_updated` and `project_seen` also use an exact recipient
list — the caller only — even though their rows survive the commit: both are
per-user, so the events exist solely to sync the caller's other devices and
must never reach other members.
`project_changed` is the one broadcast that is not a project-list row. It says
only that something happened in a project, once per request however many
mutations it made, so that a member sitting on the project list — subscribed to
no room at all — can raise the unseen dot without polling. It carries
`actor_user_id` — the same field, from the same classification, as every board
mutation — rather than being withheld from its own actor, because the actor's
_other_ devices still need it; only the dot ignores its own. Nothing
per-reader may ever ride in it, `has_unseen_changes` least of all: one
recipient's answer would be wrong for every other member of the same board.
The same rule is why the `project_updated` broadcast carries the projects-list
item without `sort_key`, `last_seen_at` or `has_unseen_changes`.
`invitations_changed` is the one **editor-scoped** event: its subject is the
board's pending invitations, which are made of email addresses and which only
editors may read, so the delivery re-check is narrowed from "can access this
project" to "can write it" — creator plus `project_member` rows whose role is
exactly `editor`, normalized fail-closed like everywhere else. A viewer, a
signed-in non-member sitting in a public board's room, and an unrelated socket
all receive nothing. The narrowing lives in the delivery layer, not in the
publishers: it is checked before the exact-recipient shortcut, so an entry
carrying a recipient list can only ever narrow the set further, and an
editor-scoped entry with no project reaches nobody. It is also broadcast, so
the candidates are every authed socket rather than the board's room: the share
panel opens from the project list too, and a client sitting there is subscribed
to nothing, so a room-scoped event would leave exactly the panel this exists for
stale. Widening the candidates is safe because the editor re-check, not the
room, is what decides. The payload deliberately
carries no address, not even the changed invitation's id — it says which board's
list moved, and a client that may know the addresses refetches
`GET /api/projects/:id/invitations`, which is editor-gated already. An event
that never puts an address on the wire cannot leak one however delivery is
later changed. It is not a webhook event, and it raises no unseen-changes dot:
`project_changed` would broadcast to every viewer that something they may not
read had happened. It is published by inviting an address, revoking, resending,
by the invitation dropped when an invited address turns out to have an account,
by the revocation that follows losing write access, and by a claim consuming
one.
`sessions_revoked` is never delivered to a client: the transport intercepts it
and closes sockets instead. A payload of `{ user_id }` closes that user's
session sockets only; one that also carries `personal_access_token_id` closes
only the sockets authenticated with that token; and one carrying `session_id`
closes only the sockets of that one session. It is published by session
revocation, token revocation and account deletion — the last of which sends one
user-scoped entry plus one per token, since the user-scoped form deliberately
spares live personal access tokens. Password change and reset publish nothing:
they revoke nothing.
`user_updated` (emitted on avatar upload/removal and on `PATCH /api/auth/me`
name/email changes, never from password or session flows) carries
`project_id: null` and is broadcast to the changed user's own sockets (their
other devices) plus every authenticated socket whose user shares at least one
project with them — creator or member on either side, re-checked live per
event with a single query over the connected users. That recipient set is
the visibility set of the global `GET /api/users` listing (the per-project mode can be broader via task assignees; those extra viewers simply do not receive live updates), so the event
never tells anyone about a user they could not already fetch. The payload
carries no email address: no user record does.
`account_updated` is the one **self-only** event. It carries the `Me` record —
`{ id, name, avatar_url, email, email_verified }` — and is published with an
exact recipient list naming the subject alone, so the delivery layer's
exact-recipient shortcut sends it to that account's own sockets and to no other
socket at all, project-sharers included. That is why it may carry the address
where `user_updated` may not: `user_updated` fans out to everyone sharing a
project and so may describe one person to another only in public fields, while
this one never leaves the account it describes. It has exactly two publishers,
which are the two ways the private half of that record moves. `POST
/api/auth/verify-email` publishes it only when the redemption really flipped
`email_verified_at` from null — a replayed token, or one whose address moved
underneath it, updates no row and announces nothing. `PATCH /api/auth/me`
publishes it whenever the stored address changes, a change of letter case
included, because that is the field only this event carries; the verification
reset and the fresh verification email still happen only for a move to a
genuinely different mailbox. Avatar upload and removal publish nothing here, and
neither does a name-only edit: `name` and `avatar_url` are public and already
reach the subject's own sockets on `user_updated`, and a second event would put
an address on the wire for a change that never touched one. A client holding a
`Me` record therefore applies both events to it. Signup and login need no event
— each answers with the record — and password change, password reset and
account deletion move no field in it.

### Outbound webhooks

A project can register up to ten HTTP(S) endpoints that receive a signed `POST`
for every board event it emits. The vocabulary is the realtime catalogue above —
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

`data` is exactly the realtime `data` for that type — one declaration produces
both, so the two cannot drift. That includes `actor_user_id` on every board
mutation, which is additive to version 1 and is `null` for a schedule's or a
background job's write. `GET /api/realtime-events.json` describes this
body too, as `WebhookEvent`. Headers:
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
`label_deleted`, `comment_created`,
`comment_updated`, `comment_deleted`, `checklist_item_created`,
`checklist_item_updated`, `checklist_item_deleted` and `project_updated` —
which is also the event for publishing or unpublishing a board's public link.
Task activity writes no event of its own, so it arrives as the mutation that
caused it.

**Never delivered.** `user_updated`, `account_updated` and `sessions_revoked`
are not project data, and two of the three carry an email address.
`project_position_updated` and `project_seen` are
per-user, and `project_changed` only restates a change that already went out
under its own type. The three `series_*` types describe board configuration
rather than board data, and the card an occurrence produces arrives as an
ordinary `task_created`. No
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
with it, so it cannot be hashed like a session token. Every editor of the
project can read it, which means handing someone edit rights also hands them
every webhook secret on the board; the list route omits it for a viewer, since
holding it is enough to forge a delivery. Rotation has a window: a delivery a
worker already claimed signs
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

### Background jobs

Deferred and recurring server-side work runs off the `job` table, leased with
`for update ... skip locked` by a tick inside the API pods. There is no HTTP
surface: nothing about a job belongs to a project, and the authorization model
here is project-scoped only, so there is no role that could be allowed to see
one. Registering a kind is a code change.

Registered kinds are `attachment_unfurl`, and the two periodic sweeps
`task_series_materialize` and `assignment_digest`.

`attachment_unfurl` fetches the title,
description, preview image and favicon for a link attachment. It is one-shot,
carries `{ attachment_id }` and nothing else, and never throws for a network
outcome — a target that refuses, times out or resolves to a blocked address
settles the row at `failed` and reports success, so a link cannot sit at
`pending` behind six hours of backoff. Two concurrent runs race a guarded
`update ... where unfurl_state = 'pending'`; the loser reclaims the storage
objects it wrote and publishes nothing.

Webhook delivery does **not** use this. `webhook_delivery` keeps its own table
and claim because it carries per-receiver behavior a generic table cannot hold
— a fairness cap per registration, a circuit breaker that locks the
registration before the delivery, an auto-disable exemption for manual
re-sends, and a cascade from the registration that discards a backlog for free.
The two share only the tick loop.

**Why not pg-boss or graphile-worker**, which would supply cron, dead-lettering
and inspection for free: both install and migrate their own schema from the
process that starts them unless they are separately pre-migrated, and this
deployment runs migrations to completion in a Job _before_ any pod rolls, with
a strict-ordered migrator that refuses anything out of sequence. Both also want
a connection string, where nothing here has one — the pool is assembled from
discrete `DB_*` parts — so either would arrive with a second pool beside the
request path's. Those are deployment-shape objections, not code-reuse ones: with
webhooks staying put, this runner reuses almost nothing that already existed.
Revisit if a second periodic consumer wants cron expressions or a dashboard.

**Two lifecycles.** A job with no interval is one-shot: it runs, and the row is
deleted on success. On failure it backs off 30s, 2m, 10m, 1h and 6h, six
attempts in all, and then parks at `status = 'failed'` — retained, not deleted,
because a pruned poison job is an invisible one. A job with an interval is a
schedule: exactly one row exists per kind for as long as the kind does, success
re-arms it at `now() + interval`, and failure backs off to a ceiling of ten
minutes but is **never** retired for failing — retiring a schedule would
silently stop every occurrence it drives.

Schedules are declared by the handler, not by the table: every few minutes each
worker re-seeds what its registered handlers ask for, so a deleted row comes
back, a changed interval takes effect, and dropping `intervalSeconds` from a
handler deletes the schedule — all without touching the database by hand. That
last step only ever removes a schedule for a kind the process still has a
handler for; one it has never heard of belongs to another release, which is
also why a kind that no pod handles shows up in the backlog warning instead of
being cleaned up.

**Enqueueing takes the caller's connection**, so a job commits or rolls back
with the mutation that caused it. That is a stronger guarantee than the webhook
and realtime publishes, which are post-commit hooks and therefore at-most-once.

**Delivery is at-least-once, and the duplicate can be concurrent.** A handler
that outlives its lease is re-claimed while it is still running, and shutdown
does not drain at all: SIGTERM stops the ticks and the process exits as soon as
the pool does, so a handler that may run for up to 20s is cut off mid-write on
every deploy and only lease expiry recovers the row a minute later. Handlers
must therefore be idempotent under concurrency, not merely under repetition,
and must treat a target row that has since been deleted as success — no foreign
key covers this table, so nothing else will ever discard a job whose subject is
gone.

**Payloads carry ids, never contact details.** Nothing reads this column and
nothing reviews what enters it, so an address written here would outlive every
consent and access check that authorized it. Handlers re-resolve from ids at
run time; the enqueue rejects a payload containing an address or a field named
for one.

**Failures are visible in the log, not over HTTP.** A worker logs each failed
attempt, and every few minutes reports how many rows are parked in `failed` and
any pending kind it has no handler for — repeatedly rather than at boot, since
a row that parks hours in would otherwise never be mentioned. Retrying a parked
job is
`update job set status = 'pending', attempts = 0, run_at = now() where id = ...`.

**Rolling deploys.** The claim is restricted to the kinds the claiming process
registered, so an old pod leaves a new release's kind alone instead of claiming
it, finding no handler and burning its attempts.

**The lease is a budget, not a lock.** A tick claims at most 8 jobs, no handler
may declare a timeout over 20s (refused at registration), and at most 4 run at
once — so a claimed row waits behind at most one other and 40s of handler time
covers the batch, inside a 45s tick budget and a 60s lease. Raising any of those
without redoing that arithmetic makes double execution routine rather than
exceptional, which is why a test asserts the whole chain rather than the ends of
it. The 40s is handler time only: a tick that also spends real time in the
database can still overrun its lease, and the idempotence contract above, not
this budget, is what makes that safe.

**The concurrency limit is process-wide, not per tick.** Overrunning the tick
budget releases the no-overlap latch without stopping the handlers the slow tick
started, so ticks genuinely do overlap; the limit is a reservation taken before
the claim, and a tick that finds no free slot claims nothing at all. Without
that, every further tick during a slow spell would pile another four handlers —
and the connections they hold — onto the 10-connection pool the request path
shares with webhook delivery.

### Email

Password-reset, email-verification, board-invitation, notification and feedback
emails all go through the driver named by `EMAIL_DRIVER`:

- `console` (default) — logs the full email; the reset link is usable from the
  server log in development.
- `ses` — sends via AWS SES v2. Requires `SES_FROM_ADDRESS`, a region
  (`SES_REGION`, or `AWS_REGION`/`AWS_DEFAULT_REGION` the SDK's own way), and
  standard AWS SDK credentials in the environment. The SDK is loaded on first
  send only.

`assertEmailConfig` in `src/config/env.ts` checks that pair at boot, beside
`assertProxyConfig`, and only when `EMAIL_DRIVER=ses` — console and memory
deployments are untouched. It is a boot failure rather than a first-send failure
because every send in the product runs inside a post-commit hook, where a throw
is caught and logged and the request still answers 2xx: a production deploy
missing `SES_FROM_ADDRESS` used to look perfectly healthy while sending no mail
at all. `SesEmailSender.send` keeps its own check as a backstop, since both
variables are read live from `process.env` and a process can enter SES mode
after boot; the boot assertion only ever speaks for the configuration it saw.

`POST /api/feedback` (authenticated) stores user-submitted feedback in the
`feedback` table and emails it to `FEEDBACK_EMAIL_ADDRESS` (default
`criticalpath@skylerberg.com`) after the transaction commits. With
`EMAIL_DRIVER=console` (as in production today) feedback emails land in the
server logs until SES is enabled; the stored row is the source of truth either
way.

`PASSWORD_RESET_SECRET` signs reset tokens and is required in production
(development falls back to a fixed dev-only secret). The link target is
`APP_URL_BASE` plus `/reset-password`, built in `src/services/webLinks.ts` with
every other link the server mails; no environment variable moves it.

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

Signup's send carries no budget of its own: every account it creates is mailed.
Signup is the only thing that sends this mail unauthenticated, so the per-IP cap
on creating accounts (see [Development](#development)) already bounds it, and a
second, lower budget could only withhold mail from a legitimate burst. An office
of twenty signing up together would have had ten of them silently receive
nothing — exactly the case the link exists for.

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
realtime payload, which fans out to everyone who shares a project. The one
realtime payload carrying the address is `account_updated`, which is the `Me`
shape and which is delivered to the subject's own sockets and nowhere else. No
user record discloses one person's address to another, on private boards or
anywhere else; the one place an address is on the wire between two people is a
pending invitation, which only editors may read and which exists because an
editor typed that address.

### Notification email

Four events, and only four, produce email: `task_assigned`,
`bulk_task_assigned`, `added_to_project` and `mentioned`. All are
direct-address — somebody put your name on something — which is why none needs
a per-project mute. Everything else (unblocks, activity summaries, anything a
board does on its own) is deliberately not built.

`bulk_task_assigned` is the one digest. A selection assigned in one action
would otherwise be one email per card, which is the pattern that trains people
to filter this app's mail, so the cards are queued in
`pending_assignment_notification` and coalesced per (recipient, actor, project)
into a single "Skyler assigned you 20 cards in Roadmap". See below for the
window it waits.

Delivery is gated per recipient in the notification layer on four conditions:
the recipient must not be the person who caused the write, the address must be
verified, the recipient must not have switched that kind off, and the recipient
must still have access to the project. The gates are **not** in the email
sender, which is what keeps account-access mail — verification, password reset,
feedback — sending unconditionally. Because they run per recipient, one
unverified, opted-out or since-evicted person on a board never suppresses mail
to the others.

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
  sends nothing. `notify` drops the actor before it queues anything, so a write
  naming only yourself costs nothing at all — and the eligibility gate drops
  them again at send time, which is what makes the rule hold for a publisher
  that builds its own notification and never runs `notify`. The actor is a
  required argument there rather than something each mailer remembers, because
  the mailers that skip `notify` are exactly the ones written last.
- **Only additions.** Re-saving the same assignee set, changing a role,
  removing a member and transferring ownership all send nothing.
- **Copying is not writing.** Duplicating a card carries its assignees but
  notifies nobody, and neither does copying a whole board.
- **Only a person.** A card a recurring schedule materialises carries the
  series' assignees and mails none of them. The actor on that write is whoever
  set the schedule up, months ago and for every occurrence at once; a card
  arriving because Tuesday came round is not somebody putting your name on
  something, which is the whole of what this mail is for.

One write mails at most 100 people. Sends run as post-commit hooks, so a
mutation that rolls back after queuing its notification sends nothing, and a
failed send never affects the response; one recipient's failure does not stop
the sends queued behind it, and leaves a log line as its only trace.

Preferences are one boolean per kind, all defaulting to true:

- `GET /api/auth/me/notification-settings` and
  `PATCH /api/auth/me/notification-settings` (authenticated,
  `{ task_assigned, bulk_task_assigned, added_to_project, mentioned }`). They
  are deliberately not part of `PATCH /api/auth/me`, which publishes to
  everyone sharing a project.

Every key of the body is optional and it changes only the ones the body names,
returning the whole set either way — `PATCH` rather than `PUT` because that is
what it does. A body naming nothing is a read. That shape is what lets a client
send the toggle the user just moved rather than the set it happens to be
holding, and it is what stops the release that adds a kind from refusing every
save made by a client that predates it — a browser tab loaded before the deploy
included.

The digest has its own toggle rather than riding on `task_assigned`: the set is
per kind, and someone who wants to hear about a card handed to them personally
is not thereby asking to hear about a sweep of twenty.

#### The bulk assignment digest

`POST /api/tasks/bulk-assignees` writes one `pending_assignment_notification`
row per (recipient, actor, project, card) inside its own transaction, so the
queue rolls back with the assignment. The actor is dropped there, as everywhere
else. A periodic job flushes them.

A group goes out once its actor has been quiet for two minutes, or fifteen
minutes after its oldest card whichever comes first. Per bulk action was the
simpler reading and was rejected: two bulk assigns a minute apart are one
sitting and deserve one message, and the cap is what stops a sender who never
stops from holding the message forever.

A flush claims the group's rows `for update skip locked`, deletes them and only
then sends, so two replicas sweeping the same group produce one email rather
than two — and a group whose rows another replica already holds is skipped
rather than re-read forever. The rows are deleted whatever the gates then
decide, since a recipient who has the kind switched off must not accumulate a
queue. The consequence is that a send that fails loses that message; it is not
retried and not dead-lettered, exactly as every other notification here.

At most 500 cards are resolved per flush, and the remainder simply goes out on
the next tick as a second digest.

Everything is re-read at send time, not trusted from the queue: the window is
minutes wide, so the recipient's preference, their verified address, their
access to the board, and whether each card is still live and still theirs are
all evaluated then. Cards archived or unassigned in the meantime are dropped
from the count, and a digest with nothing left sends nothing. The repeat budget
is keyed on a fingerprint of the claimed card set rather than on the board, so a
second, different selection is not mistaken for a repeat of the first — and the
same selection handed over twice in an hour still is one.

**Rollback runbook.** If a release carrying this is rolled back, the periodic
`job` row survives with no handler anywhere. It is never claimed, but it appears
in the recurring `unregisteredKindBacklog` warning forever, and queued rows then
accumulate unflushed. Clear both with `delete from job where kind =
'assignment_digest';` and `truncate pending_assignment_notification;`.

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
`postCommitHooks`: the caller's avatar plus every attachment object — file,
preview, favicon and image alike — in a project they created. Anything they
uploaded into someone else's project is deliberately left alone: no attachment
row records an uploader, the row survives with its project, and deleting the
object would blank a picture or break a download on a live card someone else
still owns. An account's key set is unbounded, so the hook deletes in batches and
settles each one: a key that fails is logged individually, because after the
rows are gone the log line is the only trace of the orphan.

**Realtime.** Members left behind get a `project_updated` per project the
deleted user belonged to and a `task_relations_set` per task they were assigned
to, both published after the deletes so the payloads carry the post-state. The
caller's own sockets close via `sessions_revoked` — one user-scoped entry plus
one per personal access token, because the user-scoped form closes session
sockets only. The owned projects emit no `project_deleted`: by the guard they
had no members, so the caller was their only viewer.

### Account export

`GET /api/auth/me/export` hands the calling account everything held about it
that is not board content, as one `application/json` body with
`Content-Disposition: attachment; filename="critical-path-account-<YYYY-MM-DD>.json"`.
It is free, gated by nothing but authentication, and not metered — the same as
the project export. A personal access token may fetch it: every collection in it
is already readable one endpoint at a time, so the export adds no reach, only
convenience.

There is no zip. Nothing here has bytes to package, and an archive holding one
JSON file is worse than the file. The filename carries no user text either,
unlike the project export's slug: a display name may legitimately be an email
address, and this one would land in a logged response header.

```jsonc
{
  "format": "critical-path-account-export",
  "version": 1,
  "exported_at": "2026-08-02T12:00:00.000Z",
  "account": { "id", "name", "email", "avatar_url", "created_at",
               "email_verified_at",
               "notification_settings": { "task_assigned", "bulk_task_assigned",
                                          "added_to_project", "mentioned" } },
  "sessions":                [ { "id", "user_agent", "created_at", "expires_at" } ],
  "personal_access_tokens":  [ { "id", "name", "created_at", "expires_at" } ],
  "feedback":                [ { "id", "message", "page_path", "created_at" } ],
  "projects":                [ { "id", "name", "role", "joined_at" } ]
}
```

- `version` is bumped only on a breaking shape change, the same rule the project
  export follows.
- `sessions` lists **every** session row, including ones already past
  `expires_at`. `GET /api/auth/sessions` hides those on purpose — they
  authenticate nothing, so listing them would misreport where the account is
  signed in — but nothing prunes them either, so the rows and their recorded
  `User-Agent` persist. An export that reused that filter would answer "what do
  you hold about me" with a strictly smaller set than what is held.
- `projects` is a pointer list, not board content: one entry per board the
  account created or is a member of, archived boards included. `role` is `owner`
  for a board it created (`project.created_by`; a creator has no membership row),
  otherwise the `editor`/`viewer` on that row, normalized fail-closed like
  everywhere else. `joined_at` is the membership row's `created_at`, or the
  board's own for one the account created. No member ids, no other names.
- `avatar_url` is the server-relative `/api/avatars/<key>` every user-shaped
  response carries. Unlike the project export's image files it stops resolving
  once the account is gone, so fetch the bytes before deleting the account.
- Ordering: sessions, tokens and feedback newest first; projects by name.

**Nothing about another person appears anywhere in it, and no credential
material does.** Deliberately absent, each for its own reason:

- `password_hash`, and the `token_hash` of every session and personal access
  token — bearer-equivalent or close to it.
- `alternative_id`. It is the entire subject of the stateless password-reset
  HMAC and is rotated on password and email change. Not forgeable without the
  signing secret, but it has never left the server and there is no reason for it
  to start.
- `avatar_storage_key` — `avatar_url` is the same value in its already-published
  form.
- **Pending invitations, in both directions.** An invitation the account _sent_
  carries the invitee's address and a token hash, either of which alone would
  disqualify it. An invitation addressed to the account's _own_ address is a
  different case — it is keyed by that address, held, and listed by no endpoint —
  and is still left out: it is a message from someone else about a board the
  account cannot yet see, and accepting it is what surfaces it. Any later pass
  at "make the export more complete" has to answer the token hash before
  touching this table.
- Comments, activity, assignments and per-user board ordering. The first three
  are project content that arrives detached and meaningless without its card,
  and comment bodies embed mentions of other people by name and id; the last is
  a float that orders a sidebar. `GET /api/projects/:id/export`, which every
  member of a board can call, carries the assignments as each card's
  `assignee_ids`.

It does not carry comments or activity, so a user's own comments and the
activity trail naming them as actor are exportable by no route today. Fixing
that belongs in the project export, where a comment arrives attached to its
card, not here.

`tests/unit/accountExportCoverage.test.ts` enumerates every foreign key
referencing `app_user` and asserts the set matches a literal list, each entry
marked in or out, so a new user-keyed table fails the suite until someone
decides. A second census does the same for every column of the four
account-owned tables the export reads (`app_user`, `session`,
`personal_access_token`, `feedback`), because a new column on one of those is
the likelier rot — `notify_task_assigned`, `notify_added_to_project` and
`notify_mentioned` all arrived exactly that way. `project` and `project_member` are left out of it: the export
takes a pointer list from them, so their columns churn for board reasons.

Both see the catalog only: a table that holds personal data keyed by email
address — the pattern `project_invitation` already uses — is invisible to them,
and so is anything keyed by a token or a soft reference.

### Project export

`GET /api/projects/:id/export` hands any project member everything in the
project. It is free, always available, and gated by nothing but ordinary
project access (404 for anyone else).

The default response is `application/zip`, streamed, with
`Content-Disposition: attachment; filename="<slug>-<YYYY-MM-DD>.zip"`:

```
project.json          the manifest below
tasks.csv             one row per task, for spreadsheets
attachments/<id>.<ext> the real bytes of every attached file and image,
                      archived cards included
```

Images and files ship as bytes, not URLs, so the archive keeps working after the
account or the storage bucket goes away. `?format=json` returns `project.json`
alone — no bytes; fetch an image from `GET /api/images/:id` and a file from
`GET /api/attachments/:id/download`, one per `tasks[].attachments[]` entry whose
`path` is not null.

`project.json` is the stable, documented interchange format the importer reads
back:

```jsonc
{
  "format": "critical-path-project-export",
  "version": 4,
  "exported_at": "2026-07-26T12:00:00.000Z",
  "project": { "id", "name", "description", "archived_at", "created_at",
               "created_by", "member_ids", "is_public", "color" },
  "users":   [ { "id", "name" } ],
  "columns": [ { "id", "name", "sort_key", "is_done" } ],
  "labels":  [ { "id", "name", "color" } ],
  "tasks": [ {
    "id", "column_id", "title",
    "description": "<tiptap doc or null>",
    "sort_key", "due_date", "created_at", "updated_at",
    "archived_at": "<ISO timestamp if the card is archived, else null>",
    "cover_image_url": "<'/api/images/:id' for the cover image, or null>",
    "label_ids": [], "assignee_ids": [], "blocker_ids": [],
    "attachments": [ { "id", "kind", "is_cover", "path", "title", "description",
                       "filename", "content_type", "size_bytes", "url",
                       "unfurl_state", "created_at" } ],
    "checklist_items": [ { "id", "text", "checked", "sort_key" } ]
  } ]
}
```

- `version` is bumped only on a breaking shape change. It went to `2` when
  archived cards joined `tasks[]`: a reader of a `1` export could take every row
  as live, which is no longer true. It went to `3` when `users[].email` was
  dropped: no user record carries an address any more. `checklist_items` was
  added without a bump: a reader of a `3` export keeps parsing, since an absent
  key and an empty checklist mean the same thing. `attachments` was added the
  same way, and for the same reason.
- `tasks[].attachments[]` lists all three kinds. A `file` or `image` entry
  carries `path` (`attachments/<id>.<ext>`, derived from the id, never from
  `filename`) and its bytes ride in the zip; a `link` entry carries `url` and
  `unfurl_state` and has `path: null`. An `image` entry also carries `is_cover`.
  Version `4` is this merge: a reader of a `3` export found images under a
  separate `tasks[].images[]`, so one that kept looking there would silently
  lose every picture. Fetched preview and favicon bytes are **not** archived — they
  are a cache of someone else's image, not the user's content — so a re-import
  keeps the link and its text and re-unfurls its pictures.
- Archived cards are exported. Each carries the `archived_at` that marks it and
  the `column_id` it was archived from, so an importer can restore it archived,
  drop it, or ask. A live card has `archived_at: null`. `blocker_ids` still
  omits blockers that are themselves archived, matching every other read.
- Ids are the original server ids. `created_by`, `member_ids` and
  `assignee_ids` resolve against `users[]`, `label_ids` against `labels[]`,
  `column_id` against `columns[]`, and `blocker_ids` against `tasks[]`. Every
  entry resolves: `blocker_ids` is same-project by construction. A task's
  dependencies on other projects are **not** in the export — an export is one
  project, and naming the far side would carry rows out of a board the reader may
  have no claim to. `open_cross_project_blocker_count` rides along as a bare
  number, so an importer can tell that such edges existed without learning what
  they were.
- Ordering is the board's: columns and live tasks by sort key, labels and users
  by name. Archived cards come after every live one, newest archive first — they
  keep the rank they were archived at, which is why an archived card's slot is
  still reserved against the unique index.
- `description` is stored verbatim, so its embedded `/api/images/<uuid>`
  sources resolve by id against the `kind: "image"` entries of the flattened
  `tasks[].attachments[]` — build the id map across the whole export, not per
  task, and tolerate a source that resolves to nothing (the image may have been
  deleted).
- `cover_image_url` takes the same `/api/images/<uuid>` form and resolves by id
  against that task's own attachments; the same entry carries `is_cover: true`.
  An importer restores it with `PUT /api/tasks/:id/cover` once the images are
  uploaded.
- `path` is derived from the id and, for an image, its content type — never from
  `filename` — so an archive can never carry a traversal path or a name
  collision. It is emitted in both formats, though with `?format=json` it names
  a file that response does not contain.
- Every stored row is listed. If a storage object has gone missing the manifest
  still lists it, the file is left out of the archive, and a warning is logged.
- Comments exist (see Task comments) but nothing about them is exported yet.
  Adding them is a version bump, and it has to answer what a mention node
  carrying another person's name and id means in a file the exporter keeps.

`tasks.csv` is the human view: a UTF-8 BOM (so Excel reads non-ASCII titles),
then

```
id,title,column,is_done,position,due_date,labels,assignees,blocked_by,image_count,attachment_count,created_at,updated_at,archived_at,checklist,description
```

one row per task in the manifest's order, RFC 4180 quoting, CRLF line endings.
`position` is the row's 1-based place in that order, not a stored value — the
ordering itself lives in `sort_key`, which is meaningless to a spreadsheet.
Labels, assignees (as names) and blockers (as titles) are joined with `"; "`,
`archived_at` is empty for a live card, `checklist` renders each item as
`[x] done` or `[ ] not done` joined the same way, and the description is
flattened to plain text, mentions included as `@label`. Values
are written exactly as the user typed them — a title starting with `=` is not
prefixed or escaped, so treat a `tasks.csv` opened in a spreadsheet the same way
you would treat any other untrusted CSV. Use `project.json` when you need
exactness.

The archive is plain zip, not zip64, so a project whose images and attachments
would push it past 4 GiB answers 413 and has to be exported with `?format=json`
plus one `GET /api/images/:id` or `GET /api/attachments/:id/download` per
object. Attachments count toward both that byte bound and the 65,535-entry
bound. With a 10 MB per-image and 50 MB per-attachment upload cap that ceiling
is far more reachable than images alone made it; widening the writer to zip64
is the fix if anyone hits it.

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
npm test                    # full suite against this checkout's own database
npm run test:watch
npm run test:coverage
npm run test:db:prune       # drop test databases whose checkout is gone
```

The suite loads `.env.test`, migrates the test DB in global setup, and
truncates all tables at suite start — never point it at a database with data
you care about.

### One database per checkout

The test database name is **derived, not configured**. `vitest.config.ts`
takes `DB_DATABASE` from `.env.test` as a base — it must end in `_test` — and
appends this checkout's directory name and a hash of its absolute path, giving
e.g. `game_dev_test_signup_ip_cap_3f2a1b9c`. `globalSetup` creates the database
on first use (`CREATE DATABASE`, so the role needs `CREATEDB`) and stamps it
with `COMMENT ON DATABASE` naming the checkout it belongs to.

This exists because the opening `TRUNCATE` is fatal to a suite running beside
it: two worktrees sharing one database meant one run wiped the other's rows
mid-test, or blocked behind its transactions until the statement timeout. With
the name derived from the path, two checkouts cannot collide even though they
copy the same `.env.test`. Two suites started in the _same_ checkout still
share its database and will still disturb each other — run them from separate
worktrees.

`npm run migrate:test` reaches the same database via `scripts/with-test-db.ts`.
Set `TEST_DB_NAME` to override the derivation entirely, `DB_MAINTENANCE_DATABASE`
(default `postgres`) to change where `CREATE DATABASE` is issued, and
`DB_POOL_MAX` (default 10, and 5 under vitest) to keep concurrent suites inside
`max_connections`.

Every run drops databases whose stamped checkout no longer exists. Databases
carrying no stamp — from before this scheme, or from another tool — are never
removed automatically; `npm run test:db:prune` lists them and `npm run
test:db:prune -- --legacy` drops them.

`tests/setup/resetProcessState.ts` clears the process-global state no test owns
— the in-process rate limiter's windows and the job runner's in-flight slot
count — before every file and before every test, so neither the file above nor
the test above can decide what a test starts from. Every test request presents
the same source IP, so a budget of 50 account creations would otherwise be
shared by a whole file.

Three globals are deliberately left out of it: the realtime socket registry, the
bus subscribers and the job handler registry. Several files open sockets,
subscribe or register handlers once per file in `beforeAll`, and clearing those
between tests would break those files rather than isolate them, so they stay
each file's own responsibility. That is why `--sequence.shuffle.files` passes
and plain `--sequence.shuffle` does not.

### Real Redis

Nearly every test file leaves Redis unconfigured and exercises the per-process
fallback instead; the two that cover the shared limiter drive a fake, which is
what gives them an injectable clock, injectable failures and a round-trip
counter. So until this, nothing ran the shipped Lua or the pub/sub anywhere.
Two more files do, against a real server, because the shared path silently
falls back to per-process state when anything about it is wrong: a broken
script, a flag the server does not support, or a client upgrade that changes a
reply type would leave every limiter running per-replica in production with
nothing but a log line to say so.

Those two files need `REDIS_TEST_URL` in `.env.test`. Without it they skip and
print a notice — except on CI, where a run that cannot reach a Redis fails
rather than quietly losing the coverage.

```sh
brew install redis && brew services start redis
echo 'REDIS_TEST_URL=redis://127.0.0.1:6379/15' >> .env.test
```

Database 15 keeps the test keys away from anything else on a local server.
Nothing ever flushes: each run prefixes its keys with a fresh UUID and unlinks
only those. It must be loopback; anything else is refused rather than trusted,
because the pub/sub channel has one name on every server and a misaimed URL
would deliver fabricated events to live sockets. `REDIS_URL` is deliberately a
different variable — setting it would put every test file on one shared signup
budget and the run would collapse into 429s.

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
cpath task block "Ship it" --by "Sign off" --by-project "Design" --project "My Project"  # across boards
cpath task unblock "Ship it" --by 0f0e2d1c-...  # a bare id needs no read access to the far side
cpath task blockers "Ship it" --project "My Project"   # both directions, both boards
cpath task duplicate "Fix the bug" --project "My Project"
cpath task archive "Fix the bug" --project "My Project"
cpath column duplicate "In Progress" --project "My Project"
cpath column move-tasks "Done" --to "Backlog" --project "My Project"
cpath column archive-tasks "Done" --project "My Project"
cpath task archived --project "My Project" --search bug
cpath task restore "Fix the bug" --project "My Project"
cpath task delete "Fix the bug" --project "My Project"  # archived cards only
cpath task checklist add "Fix the bug" "Write the regression test" --project "My Project"
cpath task checklist add "Fix the bug" - --project "My Project" < steps.md  # bullets and [x] honored
cpath task checklist check "Fix the bug" "regression" --project "My Project"
cpath task checklist promote "Fix the bug" "regression" --project "My Project"
cpath comment add "Fix the bug" "Reproduced on **staging**" --project "My Project"
cpath project invite "My Project" --email them@example.com --role viewer  # editor by default
cpath project invitations "My Project"  # pending invites: id, email, role, expiry
cpath project resend-invite "My Project" --id 3f9a1c2b   # id as listed, a prefix, or the address
cpath project set-role "My Project" them@example.com --role editor   # id, name, or address
cpath project members "My Project"      # ROLE column reads owner / editor / viewer
cpath task url "Fix the bug" --project "My Project"   # shareable web link
cpath config set default-project "My Project"   # makes --project optional
cpath config set web-url https://criticalpath.example.com   # base for task url
cpath watch --project "My Project" | jq 'select(.type=="task_created")'
```

Entity references accept a UUID, a unique id prefix (>= 4 chars), an exact
name/title (case-insensitive), or a unique substring; ambiguity is an error
listing the candidates. A user reference additionally accepts an email address,
which is tried first and matched by the server, since no user record the CLI
receives carries one; an address naming nobody visible falls through to the
name tiers rather than failing outright. Project and task references
additionally accept the
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

`cpath task checklist` has `list`, `add`, `check`, `uncheck`, `rename`, `move`,
`remove` and `promote`. An `<item>` reference resolves through the same four
tiers as every other reference, against that card's own items — id, exact text,
id prefix, unique text substring. `add` and `move` take `--top`, `--bottom`,
`--before` and `--after` like the task commands, defaulting to the bottom.
`add <task> -` reads one item per line from stdin and consumes Markdown list
markers and `[ ]` / `[x]` tickboxes as syntax, so a checklist pasted out of a
design doc arrives with its ticked state intact — each line is its own request,
so a failure part-way leaves the items before it in place. `promote` places the
new card directly below its parent and prints the card, not the item.

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
disambiguates. Scoping to a project also drops the account-scoped events —
`user_updated` and `account_updated` — which carry `project_id: null` and belong
to no project. Unscoped, note that `account_updated` puts your own email address
on stdout; it is the only event `watch` prints that contains one.

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
script is untested** — it was written from the documented behavior of
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
  an address has an account is learnable without a board at all. That is
  accepted rather than open. An address is input-only here — only a caller who
  already holds one can ask about it, and no route ever returns one the caller
  did not supply — so the answer tells an asker nothing they could not have got
  by trying to sign up. Signup's side of it is bounded anyway, at 50 an hour per
  source IP.
- `GET /api/users?email=` likewise tells a caller whether an address belongs to
  someone they share a project with, and is deliberately not metered. It ranges
  only over users the same route already returns in full and unfiltered, so it
  cannot name anyone the caller could not already enumerate; against that set it
  only confirms a guessed address, and confirming one is the point. Widening the
  set means gaining a project with the person, which runs through the
  invitation route above and its hourly budget. A limiter here would instead
  meter ordinary work: naming an assignee costs one such call.
- Ordering is a fractional index, so inserting repeatedly against the same
  neighbor lengthens each successive key by about a character per five inserts.
  The 1024-character cap allows roughly 5000 insertions at a single spot before
  a key is refused with a 422 — ordering stays correct, and re-stamping the
  column with `POST /api/columns/:id/reorder` clears it.
- Project roles are only `editor` and `viewer`. Every editor can rename,
  archive and publish the board and manage its member set — including demoting
  another editor, or themselves, to viewer; only the owner can transfer
  ownership or delete it. A project can never end up with no editor, since the
  creator is always one.
- A viewer can read a project's webhook registrations and their delivery log,
  because webhook reads are gated on access rather than role. The signing
  secret is the exception: the list route omits it for anyone whose role is not
  editor, since holding it is enough to forge a delivery to that receiver.
  Registering, changing, deleting, rotating and re-sending are editors only.
- `GET /api/images/:id` answers to project access, or to anyone once the board
  is published. A browser presents the `cp_session` cookie, because an `<img>`
  tag cannot carry an `Authorization` header; the cookie is read on these
  routes and nowhere else, so it is not a CSRF primitive. `GET
  /api/avatars/:key` answers any signed-in caller — an avatar is the same key
  on every board its owner appears on, so a per-board rule would cost a lookup
  per face and gate nothing — and an anonymous one only when its owner appears
  on a published board.
- Task images are stored exactly as uploaded — no resizing, no re-encoding (only
  avatars and link previews are re-encoded). A card cover therefore serves the
  full original, so a 10 MB upload is a 10 MB card image; there is no derived
  thumbnail.
- File attachments are stored exactly as uploaded and are safe only because of
  how they are served: `application/octet-stream`, an attachment
  `Content-Disposition`, `nosniff`, and a `default-src 'none'; sandbox` CSP that
  puts the response in an opaque origin if anything ever does load it as a
  document. They are not served from a separate origin, which would be the
  stronger answer: `/api` and `/ws` are same-origin behind one load balancer,
  the dev proxy assumes it, and the service worker caches `/api/images/` as
  same-origin, so moving them is its own piece of work. The residual risk is
  that a future route serving those bytes with a renderable content type would
  be stored XSS against the app's own origin; the download route is the only
  one that reads `task_attachment.storage_key`, and it is the only place that
  has to keep that promise.
- `GET /api/attachments/:id/preview` and `/favicon` answer to project access
  like the download route, so a preview stops being readable when someone loses
  access to the project rather than staying readable to anyone who learned the
  attachment id.
- Attachment downloads support no Range requests and no resume: the storage
  interface returns a whole buffer, so a download costs its full size in pod
  memory per concurrent request. This was already true of images and is simply
  more noticeable at 50 MB. Uploads stream; downloads do not.
- `GET /api/public/projects/:id/board` is unauthenticated and gated only by the
  project's `is_public` flag, which any member may flip. Clearing it stops the
  board being served immediately, and now takes the pictures with it: the
  images embedded in card descriptions and the card covers re-check the flag on
  every request, so a URL copied while the board was published stops working.
  An avatar is the one thing that outlives unpublishing, and only while its
  owner still appears on some other published board. Anyone who ever held the
  project id can read the board the moment it is published; there is no
  separate, rotatable slug.
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
