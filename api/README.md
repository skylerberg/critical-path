# game-dev-api

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

## Known limitations (v1)

- No email verification or password reset.
- Float `position` ordering with no automatic rebalancing.
- Single-workspace authorization: every authenticated user can see and edit
  every project.
- `GET /api/images/:id` is an unauthenticated capability URL (unguessable
  UUID) so `<img>` tags work without auth headers.
