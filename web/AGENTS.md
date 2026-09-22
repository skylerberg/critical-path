# AGENTS.md

Critical Path frontend: Svelte 5 (runes) + Vite SPA/PWA. No SvelteKit. Tailwind CSS v4.
TypeScript strict.

This is `web/`, one package of four in a monorepo alongside `api/`, `cli/` and
`preview-edge/`. The root `AGENTS.md` holds what spans them — above all the
**two-commit deploy rule**, which every change here that calls a new endpoint is
half of. `api/AGENTS.md` is the backend's manual.

**Where commands run.** A bare `pnpm run …` or `pnpm test` in this file is a
web-package command: run it from `web/`, or as `pnpm -C web run …` from the
repository root. There is no root package and no root `node_modules`, so a bare
`pnpm install` at the top of the checkout installs nothing.

## Package manager

pnpm, pinned by `packageManager` in package.json. `pnpm-workspace.yaml` is where
settings live, and it is a settings file here rather than a workspace
declaration — it has no `packages:` key, so this package is the only member.
Each of the four packages has its own copy and its own lockfile, and there is
deliberately none at the repository root (the root `AGENTS.md` covers why).
pnpm 11 reads settings from nowhere else, and **keys are camelCase** — a
kebab-case key is dropped silently.

Two behaviours that differ from npm:

- **`pnpm run x -- <arg>` forwards the `--` into argv** — the root `AGENTS.md`
  has the details; the short version is `pnpm test <path>`, never
  `pnpm test -- <path>`.
- **A dependency may not run install scripts unless `allowBuilds` says so**
  (`strictDepBuilds`), and a denial has to be written down rather than left
  out. Adding a dependency that builds means adding it there in the same
  commit.

A new worktree needs all four packages installed:
`scripts/new-worktree.sh <branch>`, at the **repository root**, does that and
copies the untracked `.env` files. A bare `git worktree add` leaves this
package with no `node_modules`, so every check fails on that rather than on the
change in it.

## The API package

The backend (Hono + Kysely + Postgres) this app talks to is the `api/` package
beside this one. Start it first on port 3001 (`pnpm -C api run dev`); Vite
proxies `/api` and `/ws` to `localhost:3001`. `src/api/api.generated.ts` and
`src/api/realtime.generated.ts` are generated from its OpenAPI spec and its
realtime document — a schema change and both regenerated clients (web's and the
CLI's) belong in **one commit**:

```sh
scripts/generate-clients.sh     # repository root; rebuilds all four
```

`codegen-ci.yaml` re-runs it on every pull request and fails when a committed
client does not match. Shipping the clients with the api change does not break
the two-commit deploy rule, because a generated client declares types and no
runtime values — only the *call sites* wait for the second merge.

**`API_PROXY_TARGET` moves that proxy**, for the dev and preview servers alike:

```sh
API_PROXY_TARGET=http://localhost:3099 pnpm run dev
```

With two branches in flight, the main checkout's api already holds 3001, so a
worktree's takes another port. Left at the default the page loads against
whichever build owns 3001 and says nothing about it, which looks exactly like
the branch's change not working.

**Neither generator needs a dump first.** `../scripts/lib/spec-source.mjs` —
shared with the CLI's generator — resolves the api package at a fixed in-repo
path, re-dumps it, and prints the absolute path it used. A missing `api/` is a
fatal error naming the path it looked for, not a quiet fallback to the network.

The deployed API is opt-in and is for generating a client **outside** this
repository, never for the app in it: `ALLOW_REMOTE_SPEC=1` (with `API_ORIGIN`
to name another server) allows the fetch, and `SPEC_URL` / `REALTIME_DOC_URL`
name one document outright. `SPEC_PATH` / `REALTIME_DOC_PATH` do the same for a
file on disk.

`RealtimeEvent` in `src/lib/realtime-types.ts` is the envelope union the
realtime generator produces: narrowing on `event.type` yields that event's
payload, so an apply site never asserts a shape. Tests build events with
`realtimeEvent()` from `src/lib/realtime-test-events.ts`, which takes a
`Partial` payload so a fixture stays short while its field *names* are still
checked.

**A required field in the generated types is not a required field on the
wire.** The spec describes the API as deployed, and a pod that predates a field
omits it while the type still says it is there. So a reader of a newly-added
field coalesces (`data.changed_task_ids ?? []`) even though `svelte-check` sees
the guard as dead. Each is written as `// Coalesced: a pod predating <what>
omits <which>`, so `grep -rn 'Coalesced: a pod predating' src` lists them.
**They are removable once the API rollout they name has reached every
environment.**

## Staying current with main

`main` moves fast, and a stale base is silent until a rebase conflicts or CI
fails on a rule the base predates. `git fetch origin && git rev-list --count
HEAD..origin/main -- web/` before starting and before pushing; rebase onto
`main` rather than merging, and re-run the checks afterwards. Run `gh pr list`
before starting too — the fix may already be open. `api/AGENTS.md` carries the
longer version.

**Mind the pathspec.** One `main` serves both projects, so the count without
one says nothing about your own base. Ask `-- api/` as well when the change
consumes a new endpoint, because that is the half that has to have landed
first.

Regenerate the clients **after** any rebase that moved `api/`, not before:
regenerating first writes every schema change `main` is about to deliver
anyway, so a two-line fix arrives as a hundred-line diff, and the dirty tree is
one `git rebase` refuses outright.

## Checks

**While working, run only the tests your change touches** — `pnpm test <path>`
takes seconds. Reach for the whole suite when a change is broad enough that you
cannot name the files it affects, and once at the end.

**Leave the full gate to CI.** `pnpm run check:all` is the whole list, in one
place — `package.json` is where to read it. It is four groups —
`check:static`, `check:suite`, `check:browser`, `check:test-guards` — and
`web-ci.yaml` runs each as a separate job (guards across two shards), gated on
a `changes` job that skips the groups a change cannot reach.

What is worth doing by hand is whatever your change actually touches: the test
files near it, and the one check that covers the thing you changed if there is
one — `check:layout:real` after a board layout change, `check:task-detail`
after touching the card overlay, `check:column-menu` after touching the column
kebab or `sortColumn`, `check:a11y` after changing markup or a colour token.
The prose check is `node scripts/check-comments.mjs` from the repository root —
run it after moving a rule between a comment and a doc.

`pnpm run type-check` — `svelte-check`, named the way the other three packages
name theirs — covers `src/` (tests included), `scripts/**/*.ts` and
`vite.config.ts`. Nothing about the test files is exempt from `strict`.

**Never run `prettier --write` or `eslint --fix` by hand.** The root
`.githooks/post-commit` runs each package's own fixers over the files a commit
touched and amends the result in, and `.githooks/post-rewrite` covers a rebase.
So `pnpm run format:check` is only meaningful on a committed tree — failing it
on uncommitted edits means nothing has fixed them yet, not that something is
wrong — and an import-order error out of `pnpm run lint` mid-edit is the
unfixed state, not a decision waiting on you. `import-x/order` is autofixable,
so put a new import anywhere in the block and let the commit sort it.

The two layout checks are different tiers. `check:layout` loads
`scripts/board-layout.fixture.html` over `file://` — a hand-written,
dependency-free mirror of the board's class chain, so a failure there is a
pure-CSS failure and the fixture is where to look. `check:layout:real` boots
vite in-process and mounts the real `Board.svelte` through
`scripts/board-probe.ts`. The fixture is a copy, so it can agree with a
component it no longer resembles — `.pi/skills/browser-repro/SKILL.md` covers
when not to trust it.

Every check that boots vite takes its own port variable and its own default —
`LAYOUT_PROBE_PORT` 5180, `TASK_DETAIL_PROBE_PORT` 5190, `A11Y_PROBE_PORT`
5200, `COLUMN_MENU_PROBE_PORT` 5210 — so moving one cannot move another, and
two worktrees can run them at the same time.

`check:task-detail` mounts the real `TaskDetail.svelte` and asserts what jsdom
cannot see about the card overlay: that opening it does not steal the caret
into the title field, and that dismissing it with an unsaved title produces
exactly **one** write. It runs under Chromium because that is the only engine
on which a dismissal takes both flush paths at once (see "Checking what jsdom
cannot model").

`check:column-menu` drives the column kebab the way a pointer does — open the
menu, expand "Sort by", pick an option — and then reads the **card order off
the DOM** and the ids off the request the board sent. A unit test that spies on
`sortColumn` proves a handler fired and says nothing about whether the column
re-orders or the menu stays open. The probe answers `POST
/api/columns/{id}/reorder` for real (`scripts/board-probe-net.ts`), and because
that answer repeats the caller's own order, the check reads the order once
before the response lands and once after — the first read is the one that can
fail.

**All six browser/guard checks take `--selftest`, and a change to what they
assert should run it:**

```sh
node scripts/check-board-layout.mjs --selftest
node scripts/check-board-layout-real.mjs --selftest
node scripts/check-task-detail.mjs --selftest
node scripts/check-column-menu.mjs --selftest
node scripts/check-a11y.mjs --selftest
node scripts/check-test-guards.mjs --selftest
```

Each re-runs its cases against something deliberately put back on the bug and
fails if any of them still *passes*. The shared failure mode is measuring
nothing and reporting green — the gesture never armed, the selector matched
nothing, the pattern it greps for stopped matching the codebase. CI runs the
checks without the flag; the flag is how you earn the right to believe them.

`pnpm run check:test-guards` is the same idea aimed at the suite:
`scripts/test-guards.mjs` lists a bug and the edit that puts it back, and the
runner requires the named tests to **fail** with that edit in place. Each guard
is one spawned `vitest` child carrying its edit in the environment, applied by
`guardMutation()` in `vite.config.ts` as the module is transformed — so a run
writes nothing to the source tree. `GUARD_SHARD=i/n` splits the list across n
runs and `GUARD_CONCURRENCY` sets the child count — environment variables
rather than flags because pnpm's argument forwarding is a documented trap (root
`AGENTS.md`). `check:test-guards:anchors` is the sub-second mid-refactor
version: it checks that every `find` still resolves and stops there. Each
`find` must match **exactly once** — a pattern that matches nothing leaves the
source correct and the tests green, which is indistinguishable from a guard
that works.

`check:a11y` runs axe-core over the real board and the real card overlay, in
**both colour schemes** — half the tokens exist only under
`prefers-color-scheme: dark`. It owns a named rule list rather than all of axe,
so a new axe release cannot turn it red on a rule nobody adopted. Two things it
cannot see, which is why the unit tests beside them exist: `title` counts as an
accessible name of last resort, and anything behind a hover or a keypress.

**The two board-layout checks take `--only=` and `--list`,** which is how to
iterate without paying for the whole gate:

```sh
node scripts/check-board-layout-real.mjs --list          # the case names
node scripts/check-board-layout-real.mjs --only=scroll   # one phase
```

The name a case **prints** is the key it is selected by. Patterns are
substrings, comma-separated or repeated; a pattern matching nothing exits 2
rather than passing over zero cases, and under `CI` a filter is refused
outright.

`scripts/board-probe.ts` answers `/api` itself (`scripts/board-probe-net.ts`)
and records every request. Nothing is mocked per-case, and the checks assert it
stays that way — mounting and scrolling must issue no requests at all, and a
drop must issue exactly one PATCH. Leave that boundary in place: without it the
probe reaches a real API on any machine that happens to be running one on 3001.

**Coverage is a discovery instrument here, and deliberately not a gate.** It
answers one question nothing else answers — which lines no test executes at all
— and it is run by hand when that question comes up, read once, and thrown
away. Nothing about it is committed: no provider in `devDependencies`, no CI
step, no threshold. There is no number to enforce because runs over an
identical tree disagree on the count, so a threshold set at the current figure
fails on noise.

```sh
pnpm add -D @vitest/coverage-v8@$(node -p "require('vitest/package.json').version")
pnpm exec vitest run --silent=true --coverage.enabled --coverage.provider=v8 \
  "--coverage.include=src/**/*.{ts,svelte}" --coverage.exclude='src/**/*.test.ts' \
  --coverage.reporter=json --coverage.reporter=text-summary
git restore package.json pnpm-lock.yaml && pnpm install
```

The version is read off the installed vitest because the provider tracks it
exactly; pnpm has no `--no-save`, so the restore is the second half of the
recipe, not an optional cleanup.

Read the uncovered **functions** list first; the per-file percentages on
`.svelte` files are not actionable, and the `// Coalesced: a pod predating …`
sites are uncoverable by construction and out of scope permanently.

## Checking what jsdom cannot model

Layout, scrolling, focus, `showModal()`, computed styles, `matchMedia`,
`Touch`: jsdom implements none of them, so a green suite says nothing about any
of it. `scripts/lib/browser.mjs` is how to see the real thing, and it is worth
a throwaway probe before believing a claim about any of the above.

The absent ones are why a few modules guard on `typeof window.matchMedia`
before reading a media query. Those guards look dead — the browser always has
it — and are load-bearing under the test runner.

The vitest suite runs on the same jsdom, and the rich text editor concentrates
the traps that have cost time there — each of these has burned a session:

- **Nothing can type into a ProseMirror `contenteditable` under jsdom.** Tests
  drive the document through the editor instance the component exports for
  exactly that (`getEditor()` in `src/components/RichTextEditor.svelte`), never
  through the DOM.
- **Tiptap's `focus` command lands on a timer**, not in the command's own tick,
  so an assertion placed right after `commands.focus()` races it: `waitFor` on
  `document.activeElement` instead.
- **`EditorView.hasFocus()` demands a DOM selection as well as the active
  element** — stricter than "the user is working in this text", and false in
  states a test has plainly focused. The component tracks focus through the
  editor's `onFocus`/`onBlur` callbacks for that reason; do not reintroduce
  `hasFocus()` as the question.
- **`document.elementFromPoint` is not implemented**, so a `mousedown` let
  through to ProseMirror's own handlers throws out of `posAtCoords` — as an
  *unhandled* error vitest attributes to the whole file, not to the test that
  dispatched it.
- **`window.open` and navigation only log "Not implemented"**, and the suite
  keeps going; `vi.spyOn(window, 'open')` wherever the code under test follows
  a link programmatically.
- The clipboard is `stubClipboard` from `src/lib/test-stubs.ts`, and nothing
  hand-rolled: the two ways the obvious `vi.stubGlobal('navigator', …)`
  spelling breaks under an editor are written out in its doc comment.

`createBrowser()` wraps Playwright rather than re-exporting it: the returned
object is `{ setViewport, goto, eval, press, click, screenshot, close }` and
nothing more. Its own header documents the signatures and the
null-on-missing-engine skip; the two things below are the ones that matter
most.

**Chromium is not the target.** `createBrowser({ engine: 'webkit' })` runs the
same probe under WebKit, which every iOS browser uses. The two disagree, and
Chromium is the optimistic one — removing a focused input fires `blur` in
Chromium and **not** in WebKit. Any question about focus, the on-screen
keyboard, or what an unmount does to a focused field wants both engines; one
green Chromium run is not an answer. Only the committed checks are
Chromium-only, so CI installs Chromium alone and a committed check asking for
WebKit would fail loudly there. `engine: 'firefox'` exists and is the one
engine `pnpm run playwright:install` leaves out; install it when a report names
it.

`mobile` defaults to **true** and models the mobile layout viewport, where
overflow *expands* `innerWidth` past the requested width; a desktop case has to
say `mobile: false`. `colorScheme` (`'light'` by default) drives
`prefers-color-scheme`, the only way to reach the dark half of the palette.
Playwright fixes both per context, so flipping either discards the page:
`goto` again after every `setViewport`.

One more trap when measuring anything colour-valued: most controls here carry
`transition-colors`, which transitions `outline-color` too, so reading a focus
ring in the same tick as `focus()` samples it mid-fade. Let it settle before
believing the value.

**To write a throwaway probe of some other component**, copy the shape the
committed ones use: a dev-only `.html` vite entry, a `.ts` beside it that seeds
the stores and `mount()`s the component, and a `.mjs` driver that boots vite
in-process. `scripts/board-probe.html`, `scripts/board-probe.ts` and
`scripts/check-board-layout-real.mjs` are one such trio;
`scripts/task-detail-probe.ts` and `scripts/check-task-detail.mjs` are the same
shape around a single component.

Traps a probe of that shape hits:

- **`import './board-probe-net'` first is load-bearing.** The api client
  captures `globalThis.fetch` when `createClient()` runs at module init, so
  whoever installs a stub after that point is talking to nobody. Imports are
  evaluated before any statement in the probe entry's body, so a stub written
  in the body is on the wrong side of that line. A probe that needs its own
  answer for a route wants a second module, imported after `board-probe-net`.
- **`board-probe-net` answers by echoing the request body, so a GET is answered
  `{}`** — not the shape the OpenAPI types promise. Every store assigns
  straight off the payload, so a probe of a component that GETs a list crashes
  on `undefined.map`. Answer that route yourself; do not add a guard to the
  store, whose contract is fine.
- **An open `<dialog>` makes the rest of the page inert.** A probe that opens a
  modal and then tests focus elsewhere reports "nothing focused" under both
  engines. `dialog.close()` first.
- **Give every negative assertion a control.** "`focus({ preventScroll: true })`
  left `scrollY` at 0" means nothing until a plain `focus()` on the same page
  is shown to move it. WebKit does not scroll on focus in cases where Chromium
  does, so on WebKit that control is what tells you the check is inert rather
  than passing.

A probe has to sit inside the repo to resolve `vite`, `playwright` and the
helper itself. **Name it `scripts/tmp-<what>.mjs`** — that prefix is ignored by
git, by eslint, by vitest's test discovery and by `scripts/check-comments.mjs`,
which is every gate that walks the tree. Delete it when you are done anyway.

**Being ignored costs the probe its Tailwind classes.** Tailwind v4 compiles
the classes it finds in whatever `.gitignore` does not exclude, so a class
named only inside a `scripts/tmp-*` file gets no rule and markup the probe
injects renders unstyled. Style injected markup inline, or check the compiled
sheet before trusting a measurement of it:

```js
const css = await (await fetch(new URL('src/app.css?direct', base))).text();
css.includes(String.raw`.w-\[134px\]`); // false ⇒ nothing is styling that element
```

## Svelte 5 conventions

- Runes only: `$state`, `$derived`, `$effect`, `$props()`, `$bindable()`.
  `runes` is set in `svelte.config.js`, so legacy `export let`, `$:` labels and
  svelte/store are compile errors rather than a convention to keep.
- Shared reactive state lives in `.svelte.ts` modules exporting a class
  instance (see `src/lib/toasts.svelte.ts`); state fields use `$state`.
- Components type their props with a local `interface Props` and destructure
  `$props()`. Extend `svelte/elements` attribute types when wrapping DOM
  elements (see `src/components/ui/Button.svelte`).
- `$props.id()` may be called **once** per component — a second call is a
  compile error. A component needing several ids calls it once into `const uid`
  and suffixes from there (see `src/components/FilterBar.svelte`).
- Event handlers are plain attributes (`onclick`, `onconsider`, `onfinalize`).
- **`$state` hands back a proxy, and the object you passed it keeps its
  original values.** Writes go through the proxy, so anything holding the raw
  object reads a snapshot frozen at construction — silently, with no type
  error:

  ```ts
  let card = $state(freshCard());
  const raw = freshCard();
  card = raw; // `card` is a proxy wrapping `raw`
  card.titleDraft = 'typed';
  raw.titleDraft; // null — the write never touched this object
  ```

  So a value captured for later use must be read back **off the `$state`
  variable** after assignment, never taken from the constructor call.

- A `$state` field read inside an `$effect` teardown is still readable, and the
  teardown does not track — which is what lets one effect reset state in its
  body and flush the outgoing value in its teardown. Svelte runs an effect's
  teardown immediately before that same effect's body, so pairing the two in
  **one** effect makes the ordering a framework guarantee; splitting them
  across two effects makes it depend on declaration order, which a reorder
  breaks silently.

- **Reading `$state` during teardown is safe; writing it is not.** A write to
  state owned by a component being torn down does not survive: the assignment
  reads back correctly on the spot and is gone by the next read, with no error
  and no warning. So **bookkeeping that has to survive an unmount cannot live
  in `$state`** — put it in a plain binding. Teardown is exactly when the last
  write of a session happens. `scripts/check-task-detail.mjs` is the guard for
  the instance of this that mattered.

## Router

`src/lib/router.svelte.ts` is a hand-rolled History router.

- `router.current` is a discriminated-union `Route` (`$state`); `App.svelte`
  switches on `route.name`. `router.path` is the full current path.
- Navigate with `router.navigate(path)` (pushState) or `router.redirect(path)`
  (replaceState), or put `use:link` on an anchor (or a container of anchors) —
  it respects modifier keys, middle-click, `target="_blank"`, and external
  origins.
- Auth guarding: set `router.beforeNavigate = (to, path) => ...` and return a
  path string to redirect. It runs on `navigate()` and popstate; the initial
  page load must be guarded by the caller (check `router.current` once the
  session store knows the auth state).

## Data pattern (for the API/store agents)

- IDs are client-generated via `newId()` (`src/lib/ids.ts`); never install
  `uuid`, which eslint restricts so the point is made where the import would
  go.
- List ordering uses string `sort_key` ranks from `fractional-indexing`
  (`src/lib/ranks.ts`), not numbers. `byRank` sorts a keyed row ahead of an
  unkeyed one and breaks ties on id.

  **A key only means anything against the list it was computed from.** A move
  that has to wait — queued offline, replayed minutes later — must therefore
  travel as `Neighbors` (`afterId`/`beforeId`) and be turned back into a key at
  replay by `placeBetweenNeighbors`, which reports `exact: false` when both
  anchors are gone. `board.svelte.ts` and `outbox.svelte.ts` both depend on
  this.
- Optimistic updates: apply the store change immediately, then fire the API
  call. On failure: `toasts.error(...)` and refetch the affected payload to
  resync — never snapshot-rollback.
- Styling uses the design tokens mapped in `src/app.css` (`bg-canvas`,
  `bg-surface`, `border-edge`, `text-ink`, `text-muted`, `bg-accent`, ...).
  They adapt to dark mode via `prefers-color-scheme`; don't hardcode gray-*
  palettes.
- Tap targets >= 44px (`min-h-11 min-w-11`).

## Tests

Vitest + jsdom; component mounting works because `svelteTesting()` from
`@testing-library/svelte/vite` is in `vite.config.ts` plugins — do not remove
it. Tests are colocated (`src/**/*.test.ts`).

**A test that needs runes has to be named `*.svelte.test.ts`.** Without the
infix the runes in it are never compiled, and the failure is not a compile
error: a `$derived` under test simply never invalidates, so every assertion
reads a stale value.

The side-effecting `import '../api/testUtils'` goes **first** in any test that
touches the network — it stubs `fetch`, `Request` and `localStorage`, and a
module that reads them at import time gets the real ones if it loads first.
`import-x/order` enforces that placement rather than exempting the tests from
it.

**A UI-layer test may not stub a store mutation to nothing.** `eslint.config.js`
bans `vi.spyOn(board, 'x').mockResolvedValue()` and its `(undefined)` twin
under `src/components/**`, `src/routes/**` and `src/lib/shortcuts.test.ts`; the
spy itself is fine, and so is a stub that supplies a return the fixture cannot
produce — `mockResolvedValue(task)`, `mockReturnValue(false)`,
`mockImplementation`.

**Do not read the ban as coverage.** Letting the method run does not make the
component test a store test: behaviour belongs in the store's own test. What
the ban buys is that a fixture that lies to the store breaks loudly instead of
being absorbed, and that a reader cannot mistake a suppressed method for a
tested one.
