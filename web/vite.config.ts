import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { svelteTesting } from '@testing-library/svelte/vite';
import { AVATAR_CACHE_NAME, IMAGE_CACHE_NAME } from './src/lib/constants';

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    svelteTesting(),
    VitePWA({
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
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'http://localhost:3001', ws: true },
    },
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
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'http://localhost:3001', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/vitest-setup.ts'],
    // Worktrees live under .pi/worktrees/** and .claude/worktrees/**; keep them
    // out of test discovery so a run from the main checkout doesn't pick up
    // (stale) tests from sibling worktrees.
    exclude: [...configDefaults.exclude, '.pi/worktrees/**', '.claude/**'],
    // Pinned west of Greenwich so the due-date assertions can actually fail: a
    // local-vs-UTC mixup is invisible on a machine already running at UTC.
    env: { TZ: 'America/Los_Angeles' },
  },
});
