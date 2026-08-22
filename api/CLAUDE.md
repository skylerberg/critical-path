# critical-path — `api/`

Backend for "Critical Path". Plain
Postgres + Kysely — no Supabase, no Docker, no OpenTelemetry.

This is one package of four in a monorepo (`api/`, `web/`, `cli/`,
`preview-edge/`). The root `CLAUDE.md` carries what is true across all of them —
in particular the **two-commit deploy rule**, which this package's changes are
half of. `web/CLAUDE.md` is the frontend's manual.

**Where commands run.** Unless it says otherwise, a bare `pnpm run …` or
`pnpm test` in this file is an api-package command: run it from `api/`, or as
`pnpm -C api run …` from the repository root. Anything naming another package
(`pnpm -C cli …`, `pnpm -C web …`) is written from the repository root; from
inside `api/` those are `pnpm -C ../cli …`.

# Package manager

pnpm, pinned by `packageManager` in each package.json. **Four packages, four
lockfiles, four `pnpm-workspace.yaml` files** — `api/`, `web/`, `cli/`,
`preview-edge/` — and deliberately not one pnpm workspace, with **no root
`pnpm-workspace.yaml` at all** (the root `CLAUDE.md` records what creating one
does, and it exits 0 while doing it). Install each where it lives:
`pnpm -C api install`, `pnpm -C web install`, `pnpm -C cli install`,
`pnpm -C preview-edge install`. The separate lockfiles are what keep
`.github/workflows/api-deploy.yaml`'s path filter exact — it names
`api/pnpm-lock.yaml` and deliberately not `cli/pnpm-lock.yaml`, so a CLI
dependency bump still cannot redeploy the production API.

`pnpm-workspace.yaml` is a settings file here, not a workspace declaration: none
of the four has a `packages:` key. pnpm 11 reads settings from nowhere else —
not `.npmrc` beyond auth and registry, not package.json's `pnpm` field, not npm's
`overrides`. Keys are camelCase, and a kebab-case one is dropped without a word.

All four files turn `verifyDepsBeforeRun` **off**, and `api/pnpm-workspace.yaml`'s
comment records the two measurements behind that. It fails on a nested package.json even
when that package is not a member, and it fails under `CI` because pnpm computes
a different `enableGlobalVirtualStore` default there than the install recorded —
which is what killed every `check:test-guards` child in `web/`, since each
is spawned with `CI=1`. Both failures survive `pnpm install`. Off is what npm did.

`allowBuilds` gates whether a dependency may run install scripts, and
`strictDepBuilds` fails the install on any that is unlisted — a denial counts,
an omission does not, and each file rules only on its own tree. `api/` allows
`argon2` and `esbuild` and denies `@scarf/scarf` in writing; `cli/` and
`preview-edge/` each allow `esbuild` alone.

Beware `pnpm run x -- <arg>`: pnpm forwards the `--` into argv where npm dropped
it, and vitest treats it as end-of-options. `pnpm test -- --shard=1/4` runs the
entire suite and passes.

# The two clients

`web/` is the Svelte 5 frontend for this API. Run the API first
(`pnpm -C api run dev`, port 3001), then the web app (`pnpm -C web run dev`,
port 5173) — Vite proxies `/api` and `/ws` to `localhost:3001`.

Both the web app and the `cli/` package generate their API client from this
package's OpenAPI spec, and both now live in this repository, which is the whole
point of the merge: **a request/response schema change and both regenerated
clients belong in one commit.** One command does all of it, from any directory:

```sh
scripts/generate-clients.sh
```

`codegen-ci.yaml` runs the same script on every pull request that touches
`api/src/` and fails if the committed clients differ from what it produces, so
this is not optional. Committing them beside the api change does not violate the
two-commit deploy rule — the generated files declare types and no runtime
values, so the web deploy they trigger ships an identical bundle; it is the
*call sites* that wait for the second merge. Root `CLAUDE.md` has both halves.

It needs no `pnpm run openapi:dump` first — every generator re-dumps before
reading, because the dump is a pure function of `api/src/` (no database, no
`.env`, under two seconds) and producing one is cheaper than reasoning about
whether the old one is stale. All of them resolve this package by a fixed in-repo
path rather than searching for a checkout, so there is no way to generate against
the wrong tree and no way to generate against a stale one; a missing `api/` is a
fatal error, not a quiet fallback to the deployed API. The individual package
scripts (`pnpm -C web run generate:api` and its three siblings) still exist and
still work — the shell script only sequences them.

They are literally one program, in `scripts/lib/` at the repository root: each
package keeps only its own `openapi-typescript` dependency (which cannot be
resolved from the root, where there is no `node_modules`) and the path it
writes. Two copies had already drifted — only one of them pruned the schemas a
deprecated operation orphaned — which is why the names, the filtering and the
freshness check are now shared rather than duplicated. See `web/CLAUDE.md` for
the frontend's conventions.

Realtime and webhook event types come from a second document,
`realtime-events.json`, because `/ws` has no HTTP request or response to put in
the OpenAPI spec — see convention 14. It is dumped locally to `api/` and
gitignored, the same as `openapi.json`, and served at
`GET /api/realtime-events.json` so a client can generate against a deployed API
without a checkout of this repo. Both the web app and the CLI generate from it,
and their committed clients record the source as `api/openapi.json` and
`api/realtime-events.json` — repo-relative, so no machine's paths land in a
committed file.

# Conventions

1. All POST/PUT/PATCH/DELETE handlers run inside a database transaction via
   `transactionMiddleware`. Route handlers access the connection with
   `c.get('db')` — never import `db` directly in route handlers. There is no
   opt-out. Post-commit work (e.g. storage object deletion) goes through
   `c.get('postCommitHooks')`.
2. Authentication is global (`app.use('*', authMiddleware)`), not per-route. A
   route serves without a token only by carrying the `skipAuth` marker
   middleware, and `assertPublicRoutes` fails at boot if the marked set drifts
   from the list in `src/utils/assert-public-routes.ts`. Never add `skipAuth`
   via `use('*')` on a sub-router: it would match every sibling sharing that
   mount prefix, and `/api/auth`, `/api/images` and `/api/attachments` each host
   public and authenticated routes together. Those three files export a second
   `PublicHono` router for their public half, because one Hono instance carries
   one context type: handlers on an `AppHono` get `AppContext`, where
   `c.get('user')` is a user; handlers on a `PublicHono` get `PublicContext`,
   where it is `AuthenticatedUser | undefined`. A service that never reads the
   user takes `Pick<PublicContext, 'get'>` so either kind of route can call it;
   one that does read it takes `Pick<AppContext, 'get'>`, which is what stops a
   public route from reaching it.
3. POST endpoints take a client-supplied `id` (enables optimistic UI).
   Duplicate id → 409. Map Postgres unique violations (code 23505, see
   `isUniqueViolation`) to 409 in handlers — pre-checks alone race.
4. Every route gets `describeRoute` with tags, summary, description,
   `security: [{ bearerAuth: [] }]` when authed, response schemas via
   `resolver(arkSchema)`, and error responses spread from `src/schemas/errors.ts`.
5. Request body validation via `jsonValidator(schema)` (strips undeclared
   keys, fails 422 with `{ error, details }`).
6. Re-export every schema module from `src/schemas/index.ts`; the OpenAPI
   schema-name registry reads that barrel.
7. Text length limits are enforced with arktype, not DB CHECK constraints.
   Non-empty CHECKs exist only where empty is never valid (names, title,
   email, color).
8. All FKs are `ON DELETE CASCADE`; don't manually delete rows the DB
   cascades. The one exception is `project.created_by`, which is `ON DELETE
   RESTRICT`: an account cannot be deleted while it still owns a project, so
   ownership has to move (`PUT /api/projects/:id/owner`) or the project has to
   be deleted first.
9. Avoid N+1 queries; prefer one bulk query (`jsonArrayFrom` correlated
   subqueries) per screen-sized read.
10. Mutations with no useful body return `c.body(null, 204)`.
11. Comments: absolute minimum, only non-obvious why.
12. Project access is strict and centralized in `src/services/authorization.ts`:
    a project is visible to its creator (implicit, never stored as a member
    row, always an editor) and to its `project_member` rows, each of which
    carries a `role` of `editor` or `viewer`. **404 for a caller with no
    access; 403 only for a caller who can already read the row.** Every
    project-scoped read asserts access (`assertProjectAccess` /
    `assertTaskAccess`); every project-scoped mutation asserts write
    (`assertProjectWrite` / `assertTaskWrite`), which is the same 404 plus a
    403 for a viewer. A new mutating route that asserts only access is a
    defect. Three categories are the deliberate exceptions, and all assert
    access rather than write: comments, because viewers may post, edit and
    delete their own; a row keyed to the calling user and observable by
    nobody else (`project_user_position`, `project_user_seen`), because a
    viewer who could never set their own is a bug, not a safety property;
    and `PUT /api/projects/:id/members`, which asserts access and then gates
    on the caller's role itself, because a viewer may use it to remove
    themselves and nothing else. Roles are normalized fail-closed — anything
    that is not exactly `editor` reads as `viewer`. A `task_dependency` edge is
    the one thing that spans two projects: creating one asserts write on the
    blocked side and **read** on the blocker's, and removing one asserts write
    on the blocked side alone, so an edge whose far end became unreadable stays
    detachable. Anything that reads the far side of such an edge either filters
    on access and reports a bare count for what it dropped, or reports nothing
    at all — see `src/services/crossProjectBlockers.ts` and the
    cross-project-dependencies section of the README.
13. Every mutation emits a realtime event via `publishAfterCommit` from
    `src/services/realtime` (runs as a post-commit hook, so nothing is
    published on rollback). Events about rows or access that are gone
    post-commit (`project_deleted`, membership-removal evictions) must
    snapshot `recipientUserIds` inside the transaction; events about live rows
    rely on the delivery layer's per-event access re-check. Every fact about a
    type — that it exists, whether it reaches webhook registrations, whether it
    raises the unseen-changes dot, whether its payload names the acting user
    (`carriesActor`), and whether it carries a project — is one row of the table
    in `src/services/realtime/eventCatalog.ts`. Adding a type there is what makes
    it publishable, so the classification cannot be left half-done, and a unit
    test holds the README table to the same set.
14. A type's **payload shape** is one row of a second table,
    `src/services/realtime/payloads.ts`, and the two tables are pinned to each
    other: a type in the catalog with no payload row does not compile.
    `publishAfterCommit` and `publish` are generic over the event type, so a
    payload that disagrees with its row is a type error at the publish site
    rather than a README row that drifts. Reuse the request/response schema the
    payload actually is (`boardTaskSchema`, `columnSchema`, …) instead of
    restating its fields, and never re-export this module from
    `src/schemas/index.ts`: the OpenAPI schema-name registry throws on two
    schemas with identical JSON Schema, which the bare `{ id }` payloads are.
    `actor_user_id` is merged in from the catalog rather than restated on the
    twenty-eight rows that carry it, and it is required, which is what forces the
    two publishers outside a request — the series sweep and the unfurl job — to
    name someone. `publishAfterCommit` therefore takes `CallerPayload<T>`, the
    payload minus the field it fills in from the session; `publish` still takes
    the whole thing.
    After changing a payload run `scripts/generate-clients.sh` and commit both
    regenerated clients (`cli/src/api/realtime.generated.ts`,
    `web/src/api/realtime.generated.ts`) in the same commit as the payload;
    `codegen-ci.yaml` fails the pull request otherwise. Each generator re-dumps
    for itself, so `pnpm run realtime:dump` is only needed to refresh
    `api/realtime-events.json` for something else. The dump itself is gitignored
    like `openapi.json`.
15. Every `sort_key` is unique within its scope, and the `task` index spans
    archived rows on purpose, so a key a client computed — ranked against only
    the rows that client can see — is a request, not a value to store. The
    column type is `ResolvedSortKey`, a branded string defined in
    `src/db/types.ts`, and the request schemas produce a plain `string`: the
    only way across is `resolveSortKey`, `resolveSortKeys` (a run of keys
    resolved against each other as well as the scope, for a batch insert) or
    `appendKeys`. Writing a client's key straight into the row is what used to
    answer 500 on the rows it could not see; it is now a type error at the
    write site rather than a rule each new handler has to remember. Keep the
    residual `isUniqueViolation` → 409 anyway: resolving reads the scope, and
    nothing holds it until the write. Raw `sql` writes bypass the brand — the
    bulk paths that use them take the column's tail advisory lock instead, and
    a new one must do the same, in that order (tail lock, then task rows) or it
    deadlocks against the bulk move.
16. Background work is pinned the same way realtime events are, across three
    tables. `src/services/jobs/payloads.ts` declares which kinds exist and the
    shape of each payload; `registerJobHandler` and `enqueueJob` are generic over
    its keys, so a kind with no row cannot be registered or enqueued and a
    payload that disagrees with its row is a type error at the enqueue site
    rather than a re-parse inside the handler. `src/services/jobs/register.ts` is
    a `Record<JobKind, () => void>` against the same keys, so a kind that nothing
    runs does not compile, and it is called **once**, from the entrypoint beside
    the worker — never as an import side effect. `registeredJobKinds()` is both
    what `claimDueJobs` filters on and what `syncPeriodicJobs` retires schedules
    by, so a process holding a different subset than production leaves work
    unclaimed and deletes schedules it should not; registering on import gave
    tests exactly that. Payloads carry ids and never contact details
    (`assertJobPayload`).
17. A route's response statuses are declared once, in the object built from
    `src/schemas/responses.ts` (`jsonResponse` / `emptyResponse` /
    `rawResponse`), and that same object is both spread into `describeRoute`'s
    `responses` and read back as the handler's return type through
    `Returned<typeof …>`. hono-openapi validates nothing at runtime, so without
    the pairing a handler can quietly stop answering what its own spec promises —
    which is how `GET /api/tasks/:id` came to declare a required `images[]` it
    had never sent. Error bodies stay out of it deliberately: they come from
    thrown `AppError`s through `onError`, never from a handler return, so they
    remain ordinary spreads from `src/schemas/errors.ts`.

# Realtime, email, and password reset

- WebSockets are served at `/ws` on the raw HTTP upgrade (see
  `src/services/realtime/transport.ts`); `/ws` is never part of the OpenAPI
  spec. Handshake: `{ type: 'auth', token }` within 10s, then
  `subscribe`/`unsubscribe` with a `project_id`; ping/pong heartbeat every 30s.
  The handshake token is either a session token or a personal access token.
  Three ceilings bound what one caller holds open: 200 live sockets per source
  address (refused in the handshake with 429 **and then destroyed** — `end()`
  alone half-closes, and a peer that never closes its own half would hold a
  descriptor this path deliberately does not count; it is also the only one of
  the three that applies before a token is presented), 20 per account (oldest
  closed with 4429, so a reconnect is never refused by the socket it is
  replacing), and 1000 subscriptions per socket. A `subscribe` naming anything
  that is not a uuid is ignored, and one that is gets lower-cased — an
  unvalidated project id is a room key whose length and number the caller picks,
  and a differently-cased one names a room no publish can reach. Only one `auth`
  frame per socket is ever acted on: frames from one read dispatch
  synchronously, so without that a client could start a credential lookup per
  frame against a pool of ten, and two resolving together would both register,
  the second replacing the first's subscription set and stranding its rooms. All
  three ceilings are per process, so the fleet-wide figure is times the replica
  count — they bound what one process can be made to hold, not what one person
  may have.
  Credential revocation publishes `sessions_revoked` on the realtime bus, which
  closes sockets with code 4401: a payload of `{ user_id }` closes that user's
  session sockets; one that also carries `personal_access_token_id` closes only
  the sockets authenticated with that token; and one that carries `session_id`
  closes only that session's. Any new publisher must keep sending `user_id` —
  it is the dispatch fallback in `handleBusEntry`.
  Both application close codes are one table,
  `src/services/realtime/closeCodes.ts`, which `src/spec/realtime-events.ts`
  publishes as `RealtimeCloseCode`: a client generates the set it has to route
  on, so a code added at a close site and not in that table reaches no client at
  all. `tests/unit/realtimeEventsDocument.test.ts` holds the table to the codes
  every module in `src/services/realtime` can actually send, and changing it
  carries the same `scripts/generate-clients.sh` obligation a payload change
  does.
- The realtime bus is in-process by default; when `REDIS_URL` is set (as in
  production, which runs 2+ replicas) publishes fan out via Redis pub/sub so
  every replica delivers to its own sockets. Rate limits also share Redis
  counters then, falling back to per-process windows if Redis is unreachable.
- Password-reset emails go through `src/services/email` (`EMAIL_DRIVER`:
  `console` default, `ses` loads the AWS SDK on first send; `assertEmailConfig`
  in `src/config/env.ts` fails the boot when `EMAIL_DRIVER=ses` names no from
  address or no region, because every send runs in a post-commit hook where a
  throw is caught and logged and the deploy looks healthy). Reset tokens are
  stateless HMAC (`PASSWORD_RESET_SECRET`, required in production), 15-minute
  TTL. Every link the server mails is built in `src/services/webLinks.ts` from
  `APP_URL_BASE`, never in the service that sends it: the paths are pinned there
  and again in `web/src/lib/router.test.ts`, which is what keeps a
  route rename from quietly turning mail into a not-found page — and which is now
  a file in this repository, so a rename and its pin land in one commit. `POST
  /api/auth/forgot-password` answers 204 and enqueues the send as a post-commit
  hook for an address that has an account, 404 for one that does not, and 429
  past either reset budget. It is deliberately informative: signup already
  answers 409 for an address in use, unauthenticated, so a non-revealing
  forgot-password bought nothing and cost every mistyped address a silent wait.
- Every mailed-link token — password reset, email verification, unsubscribe —
  is one codec, `src/services/signedToken.ts`
  (`base64url(claims).base64url(hmac)`). The families share a secret
  (`EMAIL_TOKEN_SECRET` falls back to `PASSWORD_RESET_SECRET`), so separating
  them is what stops one family's token being spent as another's: the type is a
  required argument to both `encodeSignedToken` and `decodeSignedToken`, not a
  claim each caller remembers to check, and it is reserved from the claims
  object at the type level. A new family is a new type string, and a token
  naming no type at all verifies for nobody.
- Neither `change-password` nor `reset-password` revokes anything: both answer
  204 and leave every session and token signed in, so a change-password issues
  no replacement token. Sessions are revoked only from the sessions list
  (`DELETE /api/auth/sessions/:id`). Both flows do rotate
  `app_user.alternative_id`, which is the reset-token HMAC subject — that is
  what makes a reset link single-use, and it has nothing to do with sessions.

# CLI

`cli/` is a **sibling package** of this one (`critical-path-cli`, command
`cpath`) — a full CLI client for this API. It was nested at `api/cli/` until the
monorepo merge, and most of what used to work by directory ancestry now has to
be written down: it carries its own `eslint.config.js`, `.prettierrc.json`,
`.gitignore` and a self-contained `tsconfig.json`, because a config search that
walks up out of `cli/` reaches the repository root, where there is deliberately
nothing for it to find. It deliberately keeps its own
pnpm-lock.yaml and node_modules (`pnpm -C cli install --frozen-lockfile`) so the deployed image
and the deploy workflow's path filters are untouched by CLI changes; never
add CLI dependencies to `api/package.json`. CLI tests are part of the api
package's `pnpm test` — `api/vitest.config.ts` includes
`../cli/tests/**/*.test.ts`, and they drive the Hono app in-process via
`cli/tests/e2e/helpers.ts`, which imports it as `../../../api/src/index`. That
climbing glob is load-bearing and silent when wrong: vitest exits 0 on an
include that matches nothing, so assert the collected file count rather than the
exit status after touching it.
CLI checks run from `cli/`: `pnpm run type-check && pnpm run lint &&
pnpm run format:check`, or `pnpm -C cli run check` for all three. Knip is the
exception that covers both packages from `api/`, because `../cli` is a knip
workspace in `api/knip.json` — that is what resolves CLI imports against
`cli/package.json` instead of api's, and it is unrelated to pnpm workspaces,
which this repo still must not use. Four lockfiles is what keeps
`api-deploy.yaml`'s path filter exact: one shared lockfile would make a CLI
dependency bump redeploy the production API. After changing the API surface or a
realtime payload, run `scripts/generate-clients.sh` and commit the regenerated
`cli/src/api/api.generated.ts` and `cli/src/api/realtime.generated.ts` — in the
same commit as the schema change, together with web's, which the same script
writes. Every generator re-dumps first, so `openapi:dump` and `realtime:dump` are
only needed to refresh the dumps for something else.

# Staying current with main

`main` moves fast — several PRs an hour when more than one agent is working — so a
branch cut an hour ago is routinely behind, and *nothing tells you* until a rebase
conflicts or CI fails on a rule your base predates. Rebase onto `main` (not merge:
branches are rebased, only the PR itself lands as a merge commit) and check at
three points:

```sh
git fetch origin && git rev-list --count HEAD..origin/main -- api/   # 0 means current
```

**The pathspec is what makes that number mean anything now.** One `main` serves
both projects, so the bare count is red almost always and says nothing about
whether your base has moved: over 60 days api landed 189 first-parent commits
and web 245, and on one day it was api 6 and web 34. `-- api/` asks the question
the old bare count used to ask. Drop the pathspec deliberately when the change
spans both packages, and read the answer as two numbers rather than one. Being
behind on the *other* package is not a reason to rebase mid-change; it is a
reason to rebase before you push, because a branch that no longer applies is a
branch that no longer applies whichever package moved.

1. **Before starting.** A stale base means writing against code that has moved,
   and it is also where duplicated work comes from: run `gh pr list` and
   `git branch -a` too, because the fix you are about to write may already be
   open. That has happened.
2. **Before the full suite.** A 4-minute run against a stale base proves nothing
   about the merge, and re-running after the rebase costs the same 4 minutes
   twice.
3. **Before pushing, and again before merging.** `gh pr view <n> --json
   mergeStateStatus` reports `CLEAN` only for a branch that still applies.

After any rebase, re-run the checks rather than trusting the pre-rebase pass, and
re-run whatever generation the change involves (the client generators, which
re-dump for themselves) — a rebase can bring in a schema change that silently
invalidates a committed generated file.

One conflict is worth calling out because it resolves wrongly by default: a branch
cut before `openapi.json` or `realtime-events.json` was untracked still carries the
tracked copy, so merging main raises a modify/delete conflict on it. Keep the
deletion — the file is a dump now. Taking "modified" instead, which is the side
git's hint nudges you toward, silently puts a 140KB generated file back under
version control, and `tests/unit/generatedDocuments.test.ts` is what fails when it
does. That guard now scans the whole repository rather than this package: it
resolves the checkout root with `git rev-parse --show-toplevel` and matches by
basename, so a tracked dump under `api/`, `web/`, `cli/` or at the monorepo root
fails it. The root is the case the widening was written for — a generator whose
path anchor is one directory off writes its dump there, where nothing reads it.

Two ways a stale base has produced *wrong* conclusions here, both worth guarding
against directly:

- **Comments about build configuration go stale.** `tsc` covers `src`, `tests`,
  `scripts`, `vitest.config.ts` and `../cli`; a comment claiming tests are
  unchecked was true when written and false a release later, and one calling
  `cli/` a subdirectory was true until the merge. Read `package.json` and
  `tsconfig.json` rather than a comment describing them.
- **"No diff" is not a passing check.** `git diff --quiet <file>` is vacuously
  clean for a gitignored file, and for one a failed command never wrote —
  `openapi.json` and `realtime-events.json` are both gitignored. Assert the
  positive: the command exited 0, the file was written, the content is what you
  expected.

# Running things

- `pnpm run dev` — API on port 3001.
- **Run only the tests your change touches; let CI run the rest.** A single
  file or directory is
  `node --env-file=.env.test node_modules/vitest/vitest.mjs run <path>`, run from
  `api/`, and takes seconds. A CLI test file is reached the same way with the
  `../` prefix — `… run ../cli/tests/e2e/task.test.ts` — because those files are
  collected by this package's vitest, not by one of cli's own. The full `pnpm test` is ~3 minutes, and running it after every
  edit is most of the wall-clock in a long session for almost no extra signal —
  CI runs it on every push, sharded. Reach for the full suite once, before
  opening the PR, and when a change is broad enough that you cannot name the
  files it affects (a shared helper, middleware, a schema everything imports).
- `pnpm run test:changed` answers "which files is that" for you: it diffs against
  `origin/main` (pass another base as an argument), including uncommitted and
  untracked files, and runs every test that reaches one through the real module
  graph — so it finds the e2e file that only touches a service through three
  barrels, which a hand-picked list misses. `pnpm run test:related <paths>`
  is the same thing for paths you name yourself. Neither replaces the suite: a
  file nothing imports yet resolves to no tests at all, and a test that breaks
  through shared state rather than an import is invisible to both.
  It diffs the whole repository and then partitions: `api/` and `cli/` are the
  paths this suite has tests for, and a change anywhere else is printed as an
  explicit skipped block naming that package's own `pnpm -C <pkg> test`, rather
  than being handed to vitest to collect nothing from. The `cli/` half of that is
  pinned to `vitest.config.ts`'s include — if cli ever gets a vitest project of
  its own and leaves this one, both have to change together.
- `pnpm test` — full suite (loads `.env.test`, migrates + truncates). It needs
  the machine mostly to itself: several e2e tests drive dozens of sequential
  requests inside one `it` against a 30s `testTimeout`, and a browser or a
  benchmark running alongside fails them at exactly 30004ms, which reads like a
  hang and is not one. Re-run a failure alone before believing it.
- Reporters are chosen in `vitest.config.ts` by whether stdout is a terminal:
  the default live tree interactively, and the verbose per-test stream when
  output goes to a file or a CI log, so a long run is followable and a stall is
  visible. Never read a run through `| tail` — a pipe shows nothing until the
  command exits, whatever the reporter.
- `tests/setup/resetProcessState.ts` clears the process-global state no test
  owns — the rate limiter's windows and the job runner's in-flight count —
  before every file and every test. The realtime socket registry, the bus
  subscribers and the job handler registry are deliberately not in it: several
  files set those up once per file in `beforeAll`, so clearing them per test
  would break those files rather than isolate them, and they stay each file's
  own responsibility. That is also why `--sequence.shuffle.files` passes and
  plain `--sequence.shuffle` does not.
- The test database name is derived, never configured: `vitest.config.ts`
  appends this package directory's name and a sha256 of its absolute path to the
  `_test`-suffixed base in `.env.test`, and `globalSetup` creates it. That is
  what lets agents in parallel worktrees run the suite at once — the opening
  `TRUNCATE` would otherwise wipe or block a suite running beside it.
  **Isolation survived the merge; the readable half of the name did not.** The
  directory it names is this package's, which is now called `api` in every
  worktree, so two parallel worktrees read `game_dev_test_api_<hash>` and
  `game_dev_test_api_<other hash>` instead of being named for their branches. The
  hash still separates them — it is taken over the absolute path — but telling
  two of them apart in `psql` means matching the hash, and `COMMENT ON DATABASE`
  still records the checkout each one belongs to. Never set
  `DB_DATABASE` to reach a specific database; both the config and the workers
  assert the derived name and fail loudly. Two suites in the *same* checkout
  would still share one database, so `globalSetup` takes a Postgres advisory
  lock keyed to that name before it truncates and the second run refuses to
  start: a `TRUNCATE` landing under a live run deletes rows it has already
  created, which surfaces as one unrelated test failing on a wrong exit code
  and passing on the rerun. Run suites from separate worktrees to get them in
  parallel. `pnpm run test:db:prune` clears databases whose checkout is gone
  (add `--legacy` for unstamped leftovers).
- **Never run `prettier --write` or `eslint --fix` by hand**, here or in any
  package. The repository-root `.githooks/post-commit` runs each package's own
  fixers over the files that commit touched and amends the result in, dispatching
  by the first segment of each path, and `.githooks/post-rewrite` covers a rebase,
  which git builds without firing `post-commit`. Two consequences: `format:check`
  is only meaningful on a *committed* tree — failing it on uncommitted edits means
  nothing has fixed them yet, which is why it stays in CI, since that is the
  assertion the hook actually ran — and a lint error about import order mid-edit
  is the unfixed state rather than a decision waiting on you. `preview-edge/` is
  the one package the hook does not touch: it has a `.prettierrc.json` but no
  prettier binary of its own, so its single source file is left to editors.
- Two files check the shared Redis path against a real server and skip without
  `REDIS_TEST_URL` in `.env.test` (`redis://127.0.0.1:6379/15`, `brew install
  redis`); CI has one and fails there rather than skipping. Never put
  `REDIS_URL` in `.env.test` — that puts the whole suite on one shared signup
  budget and it collapses into 429s.
- `pnpm run type-check`, `pnpm run lint`, `pnpm run format`. `type-check` covers
  `src/`, `tests/`, `scripts/`, `vitest.config.ts` and `../cli/` — `api/tsconfig.json`
  is the check-everything project and emits nothing;
  `pnpm run build` uses `tsconfig.build.json`, which is `src/` only. `../cli/` is in that
  project despite being a separate package, so an editor resolves its files
  against real options; left out, every file under `cli/` falls back to an
  inferred project and reads as a wall of "cannot find module" that has nothing
  to do with the code — and note that the include has to *climb* now, which is
  the failure mode with no symptom: a pattern that matches nothing costs no
  diagnostic and no non-zero exit. `cli/tsconfig.json` is a second, self-contained
  copy of these same options (it has no parent to extend since the hoist), so the
  two must be kept in step, and it carries one thing api's does not: a `paths`
  mapping sending `vitest` and `@hono/node-server` to `../api/node_modules`,
  because cli's tests are executed by this package's vitest and cli does not
  depend on either. Bare-specifier resolution is the one thing that does not
  follow the include across the package boundary. In tests
  `res.json()` is deliberately `any` (`JsonBody` in
  `tests/setup/testContext.ts`): a parsed body has no compile-time link to the
  route that produced it, so name the shape with `res.json<T>()` where it
  matters rather than trying to type the client.
- `scripts/new-worktree.sh [--only <pkg>[,<pkg>]] <branch> [base-ref]` creates a
  worktree that can run all of the above: it branches, adds the worktree under
  `~/.worktrees/<repo>/<branch>`, runs `pnpm install` in each of the four
  packages, and copies the untracked `.env` and `.env.test` — which live at
  `api/.env` and `api/.env.test`, not at the checkout root, so a copy loop
  looking only at the root would match nothing and say nothing. It discovers the
  packages from `git ls-files '*/package.json'` rather than a hard-coded list, so
  a fifth package needs no edit here, and it asserts after each install that a
  `node_modules` actually appeared rather than trusting exit 0 — which is what a
  stray root `pnpm-workspace.yaml` would otherwise hand you (`No projects found`,
  exit 0, nothing installed). `--only api,web` narrows the installs; env files
  are copied for every package regardless. A worktree made by
  hand and missing any of those fails the checks for reasons that have nothing to
  do with the change in it — an uninstalled `cli/` in particular fails only the
  CLI tests, deep into a run.
  The script resolves everything from the checkout it is run in, so it works
  from another project's checkout too.
- A worktree that already exists but predates the script just needs `pnpm install`
  in each of the four package directories. It is cheap: pnpm hardlinks from one
  content-addressable store, so a second checkout costs inodes rather than
  downloads. Do not symlink `node_modules` back to the main checkout — an install
  from the worktree would then rewrite the tree the main checkout is using. Never
  put a worktree inside the repository: it is a second full copy of the codebase
  that every recursive search has to walk.

# Health, and which build is running

`GET /health` and `GET /` share one handler and answer `status` plus the
`branch` and short `commit` that produced the running code.

The status half reaches the database, which is the point of a readiness probe:
answering healthy without it puts a pod that cannot serve one request back into
the load balancer's rotation. Liveness is a TCP check rather than this one, so
a database outage drains replicas without restart-looping every one of them.

The build half is `src/config/buildInfo.ts`. The deploy substitutes `{BRANCH}`
and `{COMMITHASH}` into `k8s/deployment.yaml` as `BUILD_BRANCH` and
`BUILD_COMMIT`; there is no `.git` in the image, so nothing else could tell the
process what it is. Locally both are absent and it reads the checkout instead,
which is the case that earns its keep — two worktrees serving two ports are
indistinguishable until one of them says which branch it is. That pairs with
`src/utils/serverStartup.ts`, which already refuses to leave a bind failure
looking like a healthy server.

# Deploys and migrations

Production deploys are rolling: the migration job runs first, then old and
new pods serve side by side. Every migration must therefore be
backward-compatible with the previous release (no dropping/renaming columns
the running code still reads; do that in a follow-up release).

**The same discipline now extends past the database to the web client — see the
two-commit deploy rule in the root `CLAUDE.md`.** Both deploys fire from one
push and web wins the race by roughly two minutes, so an endpoint this package
adds must reach `main` in an earlier merge than the web code that calls it. The
constraint is the one above in a different costume: something old is serving
while something new is going out, over a window whose length you do not control.

1. Add `src/db/migrations/NNNN_name.ts` exporting `up`/`down`.
2. `pnpm run migrate` and `pnpm run migrate:test`.
3. Regenerate committed types: `pnpm run kysely-codegen`. It takes no
   `DATABASE_URL` and never reads a database you develop against — it migrates
   a scratch database from `src/db/migrations`, introspects that, formats the
   output, and drops it, so what lands in the commit is a function of the
   migrations rather than of your machine. Introspecting `game_dev` instead is
   how a column left behind by an abandoned branch gets committed looking
   exactly like a real one. The scratch database is named per checkout, so
   parallel worktrees can regenerate at once, and it carries the same checkout
   stamp the test databases do, so `pnpm run test:db:prune` reclaims one an
   interrupted run left behind. `kysely-codegen` is in knip's
   `ignoreDependencies` because that script spawns the binary rather than
   importing it, which is not a reference knip can see.
   That writes `src/db/types.generated.ts`. `src/db/types.ts` is hand-written
   and is what the app imports: it re-exports the generated module and
   overrides `DB` to brand every `sort_key` column (convention 15). A new
   ordering scope needs its scope column added to `SCOPES` in
   `src/services/sortKey.ts`; the brand follows from the column name.
