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

### Workspaces and project access

Projects are visible only to their creator and, when the project is assigned
to a workspace, to that workspace's members. Inaccessible projects return 404
everywhere (never 403), including as a copy source. Any workspace member can
rename or delete the workspace and manage its member set (`PUT
/api/workspaces/:id/members` must include the caller). Deleting a workspace
reverts its projects to creator-only. When a member is removed or a project
moves to a different scope, task assignments belonging to users who lost
access are removed in the same transaction. `GET /api/users` returns only the
caller plus users sharing a workspace with them; `GET /api/users?project_id=`
returns the users who can access that project plus users still assigned to
its tasks.

### Realtime

A WebSocket endpoint listens at `/ws` on the same server (not part of the
OpenAPI spec). Clients must send `{ "type": "auth", "token": "<session token>" }`
within 10 seconds of connecting, then may `{ "type": "subscribe", "project_id" }` /
`unsubscribe` to project rooms. The server pings (`{ "type": "ping" }`) every
30 seconds and expects a `pong`; sockets are closed with code 4401 when their
session is revoked.

Every mutation emits an event after its transaction commits. The envelope is
`{ type, project_id, data }` (`project_id` is `null` for workspace events):

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
| `project_created` / `project_updated` | projects-list item (with task counts)          |
| `project_deleted`               | `{ id }`                                             |
| `workspace_created` / `workspace_updated` | workspace with `member_ids`                |
| `workspace_members_set`         | workspace with `member_ids`                          |
| `workspace_deleted`             | `{ id }`                                             |

`task_relations_set` is emitted by the label/assignee set endpoints, blocker
add/remove, and by the cascades that strip assignees when a workspace member
is removed or a project changes scope.

Delivery: project-scoped events go to sockets subscribed to that project whose
user can access it (re-checked per event). `project_created` /
`project_updated` are broadcast to every authenticated socket, filtered by the
same access check, so project lists stay current without a room.
`project_deleted` (also sent to workspace members who lose access when a
project moves out of their workspace), `workspace_members_set` (which also
reaches the removed members), and `workspace_deleted` are sent to a recipient
list snapshotted inside the transaction, since the delivery access re-check
would otherwise exclude exactly the users who need the event.

### Email

Password-reset emails go through the driver named by `EMAIL_DRIVER`:

- `console` (default) — logs the full email; the reset link is usable from the
  server log in development.
- `ses` — sends via AWS SES v2. Requires `SES_REGION`, `SES_FROM_ADDRESS`, and
  standard AWS SDK credentials in the environment. The SDK is loaded on first
  send only.

`PASSWORD_RESET_SECRET` signs reset tokens and is required in production
(development falls back to a fixed dev-only secret). `RESET_URL_BASE` sets the
link target (default `http://localhost:5173/reset-password`).

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

`CRITICAL_PATH_API_URL` (or `--api-url`, or `cpath config set api-url`)
selects the server; `CRITICAL_PATH_TOKEN` overrides the stored token;
`CRITICAL_PATH_PROJECT` sets the default project.

After changing the API surface, regenerate the CLI's committed types:

```sh
npm run openapi:dump && npm run --prefix cli generate-api
```

## Known limitations (v1)

- No email verification.
- Float `position` ordering with no automatic rebalancing.
- No per-workspace roles: every workspace member can rename/delete the
  workspace and manage members.
- `GET /api/images/:id` is an unauthenticated capability URL (unguessable
  UUID) so `<img>` tags work without auth headers.
