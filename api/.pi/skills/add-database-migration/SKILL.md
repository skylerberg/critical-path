---
name: add-database-migration
description: Add a Kysely database migration for the Critical Path API (Postgres). Use when adding or changing tables, columns, indexes, or constraints. Covers picking the number against open pull requests, the backward-compatible rolling-deploy rule, running migrations on dev+test DBs, and regenerating the committed kysely-codegen types.
---

# Add a database migration

Migrations live in `src/db/migrations/` (Kysely `Migrator`), numbered
`<NNNN>_<name>.ts`.

## 1. Pick the number against open pull requests too

```sh
ls src/db/migrations | tail -1
gh pr list --state open --json files --jq '.[].files[].path' | grep db/migrations
```

One past the highest of *both*. The directory alone is not enough because two
branches that each take the next free number only collide once one of them
merges. Kysely orders migrations by filename and refuses to run when an executed
one is no longer at its index — `corrupted migrations: expected previously
executed migration ... to be at index ...` — so pulling the other branch's
`0053` after having applied your own leaves the local database unable to migrate
at all, and renaming your file afterwards does not clear the row the migrator
has already written into its own bookkeeping table.

## 2. Backward compatibility first

Production deploys are **rolling**: the migration job runs before any new pod
serves, and old pods keep serving through it. Every migration must be compatible with the
previous release. Never drop or rename a column the running code still reads,
and never change a constraint in a way the old code violates — do destructive
follow-ups in a **later** release.

## 3. Write the migration

`src/db/migrations/<NNNN>_<name>.ts` exporting `up` and `down`:

```ts
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').addColumn('due_date', 'timestamptz').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('task').dropColumn('due_date').execute();
}
```

Conventions:

- All foreign keys are `ON DELETE CASCADE`. Do **not** manually delete rows the
  DB cascades. The one exception is `project.created_by`, which is
  `ON DELETE RESTRICT` (an account cannot be deleted while it owns a project).
- Non-empty `CHECK` constraints exist only where empty is never valid (names,
  title, email, color). Enforce length limits in arktype, not in CHECKs.
- Look at `0001_initial_schema.ts` for the index/constraint style.

## 4. Run the migrations

```sh
pnpm run migrate             # dev DB (game_dev)
pnpm run migrate:test        # this checkout's test DB (game_dev_test_api_<hash>)
```

**Never** run `migrate:down` against a data-bearing column on `game_dev`, and
never `DROP DATABASE`/`TRUNCATE`/bulk-`DELETE` on it — it holds the owner's
real projects. Only `game_dev_test` and `game_dev_test_*` may be reset.

## 5. Regenerate the committed types

```sh
pnpm run kysely-codegen
```

Bare — it takes no arguments, and a `DATABASE_URL=…` in front of it is read by
nothing. `scripts/codegen-types.ts` gets its connection settings from
`.env.test`, then migrates a scratch database of its own from
`src/db/migrations`, introspects that, and drops it, so the output follows from
the migration you just wrote rather than from the state of any database you
develop against. Handing it `game_dev` is the failure `CLAUDE.md` describes
under "Deploys and migrations".

It rewrites `src/db/types.generated.ts`, which is the file to commit alongside
the migration. `src/db/types.ts` is hand-written and is not regenerated; it only
needs editing when a new ordering scope arrives, per `CLAUDE.md`.

## 6. Check

Run the `run-checks` skill.
