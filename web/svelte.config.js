import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  // Runes mode for every component, rather than Svelte's per-component
  // auto-detection. The codebase is already there — no `export let`, no `$:`, no
  // svelte/store — so this costs nothing today and makes each of those a compile
  // error tomorrow, which is where that rule belongs instead of in a doc.
  compilerOptions: { runes: true },
};
