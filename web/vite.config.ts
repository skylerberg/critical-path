import { realpathSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { configDefaults } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { svelteTesting } from '@testing-library/svelte/vite';
import { AVATAR_CACHE_NAME, IMAGE_CACHE_NAME } from './src/lib/constants';

// An API running anywhere other than the default port is the normal case when
// two branches are in flight: a worktree's API takes a free port because the
// main checkout's server already holds 3001, and a dev server hard-wired to
// 3001 then proxies to the wrong build without saying so.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001';
const apiProxy = {
  '/api': apiTarget,
  '/ws': { target: apiTarget, ws: true },
};

/**
 * Puts one bug from `scripts/test-guards.mjs` back, for a vitest child
 * `scripts/check-test-guards.mjs` spawns. The edit arrives through the
 * environment and is applied as the module is transformed, so a guard run never
 * writes to the source tree — which is what lets it run in CI, and beside
 * whatever else is reading these files.
 *
 * `GUARD_APPLIED_MARKER` is touched whenever the anchor is *found*, not whenever
 * the text changes, so a mutation that rewrites the anchor to itself still counts
 * as applied. That is what lets the runner tell a guard that has stopped biting
 * from one aimed at a module the named tests never load, and its selftest turns
 * on the distinction.
 *
 * Inert with `GUARD_MUTATION` unset, which is every run but a guard run.
 */
function guardMutation(): Plugin | null {
  const spec = process.env.GUARD_MUTATION;
  if (spec === undefined) {
    return null;
  }
  const { file, find, replace } = JSON.parse(spec) as {
    file: string;
    find: string;
    replace: string;
  };
  const marker = process.env.GUARD_APPLIED_MARKER;
  return {
    name: 'guard-mutation',
    // Ahead of the svelte and typescript transforms, so `find` is matched against
    // the source the guard was written against rather than against output.
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith(file) || !code.includes(find)) {
        return null;
      }
      if (marker !== undefined) {
        writeFileSync(marker, id);
      }
      // A replacer function, so `$&` and friends in a `replace` are not expanded.
      // The anchor count on the filesystem side counts literal occurrences, and
      // the two halves of the check have to mean the same thing by `find`.
      return code.replace(find, () => replace);
    },
  };
}

export default defineConfig({
  // Guard jobs run several at a time, and the default node_modules/.vite is one
  // directory every vite process on this machine shares (node_modules is a
  // symlink into the main checkout from a worktree), so a pool without this
  // pre-bundles over itself. check:a11y pins a fixed directory for the same
  // reason; here each job needs a different one, so the runner supplies it.
  ...(process.env.GUARD_CACHE_DIR === undefined ? {} : { cacheDir: process.env.GUARD_CACHE_DIR }),
  plugins: [
    guardMutation(),
    svelte(),
    tailwindcss(),
    svelteTesting(),
    VitePWA({
      // Previews run on an isolated subdomain origin, so a service worker
      // isn't needed for offline; disabling it in the preview build
      // (VITE_PREVIEW=1) avoids force-push cache-staleness within a single
      // PR's URL. `virtual:pwa-register` becomes a no-op, so appUpdate.ts is
      // unaffected.
      disable: !!process.env.VITE_PREVIEW,
      // `skipWaiting`/`clientsClaim` let a new build take over without the running
      // page's cooperation, so one long-lived tab can't pin a device to a stale
      // worker. The registration shim's reload is suppressed separately.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Critical Path',
        short_name: 'CritPath',
        description: 'Project management with kanban boards and dependency graphs',
        display: 'standalone',
        theme_color: '#4f46e5',
        background_color: '#fafafa',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/images/'),
            handler: 'CacheFirst',
            options: {
              cacheName: IMAGE_CACHE_NAME,
              // A cover puts a full-size original here on every board view, so
              // without the purge flag a quota error can evict the whole origin,
              // taking the precached app shell with it.
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/avatars/'),
            handler: 'CacheFirst',
            options: {
              cacheName: AVATAR_CACHE_NAME,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    // Allow Tailscale MagicDNS hosts so `tailscale serve` (which forwards the
    // ts.net Host header to this localhost-bound server) isn't rejected.
    allowedHosts: ['.ts.net'],
    proxy: apiProxy,
    fs: {
      // node_modules may be a symlink into the main checkout when running from a
      // git worktree; the svelteTesting() setup file resolves to its realpath,
      // which vite's default allow-list (the worktree root) would deny.
      allow: ['.', realpathSync('node_modules')],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
    allowedHosts: ['.ts.net'],
    proxy: apiProxy,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/vitest-setup.ts'],
    // Spies are restored between cases rather than by hand at the end of each.
    // The convention here is `vi.spyOn(...)` … `spy.mockRestore()` as the last
    // line, which is exactly the line a failing assertion skips — so one broken
    // test used to leave a live spy on a shared store for every case after it,
    // and the next failure reported was never the real one.
    restoreMocks: true,
    // Worktrees live under .pi/worktrees/** and .claude/worktrees/**; keep them
    // out of test discovery so a run from the main checkout doesn't pick up
    // (stale) tests from sibling worktrees.
    //
    // scripts/tmp-* is the throwaway-probe prefix (see CLAUDE.md). Those are
    // written to be run once and deleted, and one shaped like a test is usually a
    // deliberate failure used to print a value — so a forgotten one fails the
    // suite while `git status` stays clean, because the same prefix is gitignored.
    exclude: [...configDefaults.exclude, '.pi/worktrees/**', '.claude/**', 'scripts/tmp-*'],
    // Pinned west of Greenwich so the due-date assertions can actually fail: a
    // local-vs-UTC mixup is invisible on a machine already running at UTC.
    env: { TZ: 'America/Los_Angeles' },
  },
});
