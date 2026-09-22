# AGENTS.md

Critical Path frontend: Svelte 5 (runes) + Vite SPA/PWA. No SvelteKit. Tailwind CSS v4.
TypeScript strict.

This is `web/`, one package of four. The root `AGENTS.md` owns the
cross-package rules and is required reading: the pnpm workspace trap (including
pnpm's `--` forwarding), the pinned toolchain, the commit hooks that run the
formatters, the two-commit deploy rule (which every change here that calls a
new endpoint is half of), and staying current with `main`. `api/AGENTS.md` is
the backend's manual.

**Where commands run.** A bare `pnpm run …` or `pnpm test` in this file is a
web-package command: run it from `web/`, or as `pnpm -C web run …` from the
repository root. There is no root package, so a bare `pnpm install` at the top
of the checkout installs nothing. A new worktree needs all four packages
installed: `scripts/new-worktree.sh <branch>` at the repository root does that
and copies the untracked `.env` files.

## The API package

The backend (Hono + Kysely + Postgres) this app talks to is the `api/` package
beside this one. Start it first on port 3001 (`pnpm -C api run dev`); Vite
proxies `/api` and `/ws` to `localhost:3001`.

**`API_PROXY_TARGET` moves that proxy**, for the dev and preview servers alike:

```sh
API_PROXY_TARGET=http://localhost:3099 pnpm run dev
```

With two branches in flight, the main checkout's api already holds 3001, so a
worktree's takes another port. Left at the default the page loads against
whichever build owns 3001 and says nothing about it, which looks exactly like
the branch's change not working.

`src/api/api.generated.ts` and `src/api/realtime.generated.ts` are generated
from the api package's OpenAPI spec and realtime document — a schema change and
both regenerated clients (web's and the CLI's) belong in **one commit**:

```sh
scripts/generate-clients.sh     # repository root; rebuilds all four
```

`codegen-ci.yaml` re-runs it on every pull request and fails on a diff. The
generators (`../scripts/lib/`, shared with the CLI) resolve `api/` at a fixed
in-repo path and re-dump it themselves — a missing `api/` is a fatal error, not
a fallback to the deployed API. Generating against the deployed API exists only
for a client **outside** this repository: `ALLOW_REMOTE_SPEC=1` (with
`API_ORIGIN`), or `SPEC_URL` / `REALTIME_DOC_URL` / `SPEC_PATH` /
`REALTIME_DOC_PATH` to name a document outright.

**A required field in the generated types is not a required field on the
wire.** The spec describes the API as deployed, and a pod that predates a field
omits it while the type still says it is there. So a reader of a newly-added
field coalesces (`data.changed_task_ids ?? []`) even though `svelte-check` sees
the guard as dead. Each is written as `// Coalesced: a pod predating <what>
omits <which>`, so `grep -rn 'Coalesced: a pod predating' src` lists them.
**They are removable once the API rollout they name has reached every
environment.**

`RealtimeEvent` in `src/lib/realtime-types.ts` is the envelope union the
realtime generator produces: narrowing on `event.type` yields that event's
payload, so an apply site never asserts a shape. Tests build events with
`realtimeEvent()` from `src/lib/realtime-test-events.ts`, which takes a
`Partial` payload so a fixture stays short while its field *names* are still
checked.

## Checks

**While working, run only the tests your change touches** — `pnpm test <path>`
takes seconds. **Leave the full gate to CI.** `pnpm run check:all` is the whole
list — four groups, `check:static`, `check:suite`, `check:browser`,
`check:test-guards`, each a separate `web-ci.yaml` job behind a `changes` job —
and `package.json` is where to read it.

What is worth doing by hand is whatever your change actually touches: the test
files near it, and the one check that covers the thing you changed —
`check:layout:real` after a board layout change, `check:task-detail` after
touching the card overlay, `check:column-menu` after touching the column kebab
or `sortColumn`, `check:a11y` after changing markup or a colour token. Each
check's own header documents what it does and why; the prose check is
`node scripts/check-comments.mjs` from the repository root.

Every one of those checks takes `--selftest`, which re-runs its cases against
something deliberately put back on the bug and fails if any still *passes* —
the shared failure mode of a browser check is measuring nothing and reporting
green. **Run it after changing what a check asserts.** The two board-layout
checks also take `--only=` and `--list` for iterating on one case.

`check:test-guards` is the same idea aimed at the unit suite:
`scripts/test-guards.mjs` lists a bug and the edit that puts it back, and the
runner requires the named tests to **fail** with that edit in place, applied by
`guardMutation()` in `vite.config.ts` as the module is transformed — nothing is
written to the source tree. `check:test-guards:anchors` is the sub-second
mid-refactor version: it checks that every `find` still resolves exactly once
and stops there. `GUARD_SHARD=i/n` and `GUARD_CONCURRENCY` are environment
variables rather than flags because of pnpm's `--` forwarding (root
`AGENTS.md`).

**Coverage is a discovery instrument here, and deliberately not a gate.** It
answers one question nothing else answers — which lines no test executes at all
— and it is run by hand when that question comes up, read once, and thrown
away. Nothing about it is committed: no provider in `devDependencies`, no CI
step, no threshold (runs over an identical tree disagree on the count, so a
threshold would fail on noise).

```sh
pnpm add -D @vitest/coverage-v8@$(node -p "require('vitest/package.json').version")
pnpm exec vitest run --silent=true --coverage.enabled --coverage.provider=v8 \
  "--coverage.include=src/**/*.{ts,svelte}" --coverage.exclude='src/**/*.test.ts' \
  --coverage.reporter=json --coverage.reporter=text-summary
git restore package.json pnpm-lock.yaml && pnpm install
```

The version is read off the installed vitest because the provider tracks it
exactly; pnpm has no `--no-save`, so the restore is the second half of the
recipe, not an optional cleanup. Read the uncovered **functions** list first;
the per-file percentages on `.svelte` files are not actionable, and the
`// Coalesced: a pod predating …` sites are uncoverable by construction and out
of scope permanently.

`pnpm run type-check` — `svelte-check`, named the way the other three packages
name theirs — covers `src/` (tests included), `scripts/**/*.ts` and
`vite.config.ts`. Nothing about the test files is exempt from `strict`.

## Checking what jsdom cannot model

Layout, scrolling, focus, `showModal()`, computed styles, `matchMedia`,
`Touch`: jsdom implements none of them, so a green suite says nothing about any
of it. That is what the `check:browser` group exists for, and it is worth a
throwaway probe before believing a claim about any of the above.

The absent ones are why a few modules guard on `typeof window.matchMedia`
before reading a media query. Those guards look dead — the browser always has
it — and are load-bearing under the test runner.

<<<<<<< HEAD
The vitest suite runs on the same jsdom, and the rich text editor concentrates
the traps that have cost time there:

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

`scripts/lib/browser.mjs` is how to see the real thing: `createBrowser()`
wraps Playwright down to `{ setViewport, goto, eval, press, click, screenshot,
close }`, and its header documents the signatures. **Chromium is not the
target** for anything about focus or the on-screen keyboard — WebKit disagrees
with it there, and the browser-repro skill carries the difference.

**The `.pi/skills/browser-repro` skill owns the how**: reproducing a bug
against the real component, writing a probe for a new component, and the traps
that shape hits. Read it before writing a probe.

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
  (`src/lib/ranks.ts` — `append`, `prepend`, `between`, `placeAtIndex`), not
  numbers. `byRank` sorts a keyed row ahead of an unkeyed one and breaks ties
  on id.

  **A key only means anything against the list it was computed from.** A move
  that has to wait — queued offline, replayed minutes later — must therefore
  travel as `Neighbors` (`afterId`/`beforeId`) and be turned back into a key at
  replay by `placeBetweenNeighbors`, which reports `exact: false` when both
  anchors are gone, so the caller can say the card landed somewhere it was not
  aimed. `board.svelte.ts` and `outbox.svelte.ts` both depend on this.
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
