# CLAUDE.md

Critical Path frontend: Svelte 5 (runes) + Vite SPA/PWA. No SvelteKit. Tailwind CSS v4.
TypeScript strict. The app name lives in `src/lib/constants.ts` (`APP_NAME`).

## Checks (run all before finishing)

```sh
npm run check && npm run lint && npm run format:check && npm test && npm run build
```

## Svelte 5 conventions

- Runes only: `$state`, `$derived`, `$effect`, `$props()`, `$bindable()`. No legacy
  `export let`, no `$:` labels, no svelte/store.
- Shared reactive state lives in `.svelte.ts` modules exporting a class instance
  (see `src/lib/toasts.svelte.ts`); state fields use `$state`.
- Components type their props with a local `interface Props` and destructure
  `$props()`. Extend `svelte/elements` attribute types when wrapping DOM elements
  (see `src/components/ui/Button.svelte`).
- Event handlers are plain attributes (`onclick`, `onconsider`, `onfinalize`).

## Router

`src/lib/router.svelte.ts` is a hand-rolled History router.

- `router.current` is a discriminated-union `Route` (`$state`); `App.svelte` switches
  on `route.name`. `router.path` is the full current path.
- Navigate with `router.navigate(path)` (pushState) or `router.redirect(path)`
  (replaceState), or put `use:link` on an anchor (or a container of anchors) —
  it respects modifier keys, middle-click, `target="_blank"`, and external origins.
- Auth guarding: set `router.beforeNavigate = (to, path) => ...` and return a path
  string to redirect (e.g. to `/login` with the intended URL remembered). It runs on
  `navigate()` and popstate; the initial page load must be guarded by the caller
  (check `router.current` once the session store knows the auth state).

## Data pattern (for the API/store agents)

- IDs are client-generated via `newId()` (`src/lib/ids.ts`); never install `uuid`.
- List ordering uses float positions (`src/lib/positions.ts`): empty list 1000,
  append max+1000, prepend min-1000, insert midpoint of neighbors.
- Optimistic updates: apply the store change immediately, then fire the API call.
  On failure: `toasts.error(...)` and refetch the affected payload to resync —
  never snapshot-rollback.
- Styling uses the design tokens mapped in `src/app.css` (`bg-canvas`, `bg-surface`,
  `border-edge`, `text-ink`, `text-muted`, `bg-accent`, ...). They adapt to dark mode
  via `prefers-color-scheme`; don't hardcode gray-\* palettes.
- Tap targets >= 44px (`min-h-11 min-w-11`).

## Tests

Vitest + jsdom; component mounting works because `svelteTesting()` from
`@testing-library/svelte/vite` is in `vite.config.ts` plugins — do not remove it.
Tests are colocated (`src/**/*.test.ts`).
