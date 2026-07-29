---
name: change-api-schema
description: Regenerate the committed API clients in all three packages after changing a Critical Path API request/response schema (arktype in src/schemas). Use whenever an OpenAPI shape changes — the web app and the CLI both generate their client from this repo's spec and must be regenerated and committed together.
---

# Change an API schema (cross-repo regen)

The web app (`../critical-path-web`) and the CLI (`cli/`) each generate their
API client from **this repo's** OpenAPI spec. A change to any request/response
shape must regenerate both committed clients and commit them all together, or
the consumers compile against a stale contract.

## 1. Change the schema

Edit `src/schemas/*.ts` (arktype). If you add a new schema module, re-export it
from `src/schemas/index.ts` — the schema-name registry reads that barrel.

## 2. Dump the spec

```sh
npm run openapi:dump        # writes ./openapi.json without starting a server
```

## 3. Regenerate the CLI client

```sh
npm run --prefix cli generate-api    # rewrites cli/src/api/api.generated.ts
```

## 4. Regenerate the web client

From `../critical-path-web`, the generator auto-finds the sibling spec:

```sh
cd ../critical-path-web && npm run generate:api
# rewrites src/api/api.generated.ts
```

It walks up to locate `critical-path-api/openapi.json` and asserts the spec is
fresh (git-mtime check) so a stale spec can't silently drop endpoints. Override
with `SPEC_PATH=...` or `SPEC_URL=http://localhost:3001` if needed.

## 5. Commit together

One commit (or one PR) with: the schema change, `openapi.json`, and both
regenerated `api.generated.ts` files.

## 6. Check

Run `npm run --prefix cli check` here, plus the `run-checks` skill in both
repos.
