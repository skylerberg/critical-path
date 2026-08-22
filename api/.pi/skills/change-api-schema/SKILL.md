---
name: change-api-schema
description: Regenerate the committed API clients after changing a Critical Path API request/response schema (arktype in api/src/schemas). Use whenever an OpenAPI shape changes — web/ and cli/ both generate their client from api/'s spec and must be regenerated and committed in the same commit.
---

# Change an API schema

Every command below is run from the **repository root**.

`web/` and `cli/` each generate their API client from `api/`'s OpenAPI spec. All
three live in one repository, so a schema change and both regenerated clients
belong in **one commit** — that is the whole reason the repos were merged. A
commit that changes the shape without the clients leaves them compiling against
a contract that no longer exists.

## 1. Change the schema

Edit `api/src/schemas/*.ts` (arktype). If you add a new schema module, re-export
it from `api/src/schemas/index.ts` — the schema-name registry reads that barrel.

## 2. Regenerate both clients

Neither generator needs a separate dump step: both re-dump from `api/src` before
reading, because the dump is a pure function of the sources (no database, under
two seconds) and producing one is cheaper than reasoning about whether the old
one is stale.

```sh
pnpm -C cli run generate-api    # rewrites cli/src/api/api.generated.ts
pnpm -C web run generate:api    # rewrites web/src/api/api.generated.ts
```

Each prints the absolute path of the document it read. That line is the check:
it must name `api/openapi.json` in **this** working tree. `web/`'s generator
resolves the api package by fixed relative path and fails loudly if it is
missing — it will not silently fall back to the deployed API. (Generating
against production is `ALLOW_REMOTE_SPEC=1`, and is only for a client outside
this repository.)

If you changed a realtime payload rather than an HTTP schema, run
`generate-realtime` / `generate:realtime` instead — see convention 14.

## 3. Commit together

One commit with the schema change and both regenerated `api.generated.ts` files.
`openapi.json` and `realtime-events.json` are gitignored dumps and must **not**
be committed; `api/tests/unit/generatedDocuments.test.ts` fails if either is
tracked anywhere in the tree.

## 4. Check

```sh
pnpm -C api run type-check && pnpm -C cli run check
pnpm -C web run check          # svelte-check: the only thing that catches a stale client
```

A stale `web/src/api/api.generated.ts` fails **only** under `pnpm -C web run
check`, never under `pnpm -C web test`, which strips types. A green web suite is
not evidence after a schema change.

## 5. Deploying it

The api and web production deploys are independent and web is roughly two
minutes faster, so a bundle that calls a new endpoint can go live before the
pods that serve it. Land the API side in one commit and the web side that
consumes it in the next — see the two-commit rule in the root `CLAUDE.md`.
