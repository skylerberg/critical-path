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

```sh
scripts/generate-clients.sh
```

One command, run from anywhere. It dumps `api/`'s two documents and rewrites all
four clients — `{web,cli}/src/api/api.generated.ts` and their
`realtime.generated.ts` — so it is the same command whether you changed an HTTP
schema or a realtime payload. No separate dump step, no `.env`, no database and
no running server: both dumps are pure functions of `api/src`.

Every step prints the absolute path of the document it read. Those lines are the
check: each must name `api/openapi.json` or `api/realtime-events.json` in **this**
working tree. All four generators are one program — `scripts/lib/` at the
repository root, with only the output path left in each package — so the api
package is resolved by fixed relative path and a missing one fails loudly rather
than silently falling back to the deployed API. (Generating against production is
`ALLOW_REMOTE_SPEC=1`, and is only for a client outside this repository.)

## 3. Commit together

One commit with the schema change and both regenerated `api.generated.ts` files.
`.github/workflows/codegen-ci.yaml` re-runs `scripts/generate-clients.sh` and
fails the pull request if a committed client differs from what it produces, so a
forgotten regeneration is caught rather than merged.

`openapi.json` and `realtime-events.json` are gitignored dumps and must **not**
be committed; `api/tests/unit/generatedDocuments.test.ts` fails if either is
tracked anywhere in the tree.

## 4. Check

```sh
pnpm -C api run type-check && pnpm -C cli run check:all
pnpm -C web run type-check     # svelte-check: the only thing that catches a stale client
```

A stale `web/src/api/api.generated.ts` fails **only** under `pnpm -C web run
type-check`, never under `pnpm -C web test`, which strips types. A green web suite is
not evidence after a schema change.

## 5. Deploying it

The api and web production deploys are independent and web is roughly two
minutes faster, so a bundle that calls a new endpoint can go live before the
pods that serve it. Land the API side in one commit and the web side that
consumes it in the next — see the two-commit rule in the root `CLAUDE.md`.

The regenerated clients are **not** the part that waits: they declare types and
no runtime values, so the web deploy they trigger ships a byte-identical bundle.
They go in the api commit, per step 3. What goes in the second merge is the web
code that *calls* the new endpoint.
