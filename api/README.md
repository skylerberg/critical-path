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
contains `created_by`). Inaccessible projects return 404 everywhere (never
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

Copied projects start personal: members are never copied from the source.
`GET /api/users` returns the caller plus every user sharing at least one
project with them (as creator or member on either side); `GET
/api/users?project_id=` returns the users who can access that project plus
users still assigned to its tasks.

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
OpenAPI spec). Clients must send `{ "type": "auth", "token": "<session token>" }`
within 10 seconds of connecting, then may `{ "type": "subscribe", "project_id" }` /
`unsubscribe` to project rooms. The server pings (`{ "type": "ping" }`) every
30 seconds and expects a `pong`; sockets are closed with code 4401 when their
session is revoked.

Every mutation emits an event after its transaction commits. The envelope is
`{ type, project_id, data }`:

| type                            | data                                                 |
| ------------------------------- | ---------------------------------------------------- |
| `task_created` / `task_updated` | board task shape                                     |
| `task_deleted`                  | `{ id }`                                             |
| `task_relations_set`            | `{ task_id, label_ids, assignee_ids, blocker_ids }`  |
| `column_created` / `column_updated` | column response shape                            |
| `column_deleted`                | `{ id, moved_tasks }`                                |
| `label_created` / `label_updated` | label row                                          |
| `label_deleted`                 | `{ id }`                                             |
| `image_created`                 | image response plus `{ task_id, image_count }`       |
| `image_deleted`                 | `{ task_id, image_count }`                           |
| `project_created` / `project_updated` | projects-list item (with `member_ids` and task counts, without the per-user `position`) |
| `project_deleted`               | `{ id }`                                             |
| `project_position_updated`      | `{ id, position }`                                   |

`task_relations_set` is emitted by the label/assignee set endpoints, blocker
add/remove, and by the cascade that strips assignees when a project member is
removed.

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
cpath task create "Fix the bug" --project "My Project" --description "See **notes**"
cpath task move "Fix the bug" --project "My Project" --column "In Progress" --top
cpath task done "Fix the bug" --project "My Project"
cpath task block "Ship it" --by "Fix the bug" --project "My Project"
cpath config set default-project "My Project"   # makes --project optional
```

Entity references accept a UUID, a unique id prefix (>= 4 chars), an exact
name/title (case-insensitive), or a unique substring; ambiguity is an error
listing the candidates. Task descriptions are Markdown in and out, converted
to the API's restricted Tiptap JSON (`--description-json` is the raw escape
hatch).

Every command takes `--json` for machine-readable output and `--no-input` to
fail instead of prompting. Exit codes: 0 ok, 1 network/server error, 2
usage/ambiguous reference, 3 auth, 4 not found, 5 conflict, 6 invalid input.

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
