#!/usr/bin/env node
// Accessibility check: runs axe-core against the REAL components — the board via
// scripts/board-probe.html, the card overlay via scripts/task-detail-probe.html —
// in both colour schemes.
//
//   npm run check:a11y
//
// Both schemes because the palette is defined twice: half the tokens exist only
// under prefers-color-scheme: dark, so a light-only run reads none of them. Four
// of the contrast failures this was written for were dark-only.
//
// Boots vite in-process on the first free port at or above 5200 (override with
// A11Y_PROBE_PORT), measures, tears down — so this can run beside the layout
// checks and a killed run leaves no server behind. Skips with exit 0 if Chromium
// isn't installed. Exits non-zero on any violation.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { createBrowser } from './lib/browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

const SELFTEST = process.argv.includes('--selftest');

// The rules this gate owns. Named rather than run-everything, so a new axe
// release cannot turn this red on a rule nobody chose to adopt — and so the list
// reads as the promise being kept.
const RULES = [
  'color-contrast',
  'button-name',
  'link-name',
  'image-alt',
  'role-img-alt',
  'input-image-alt',
  'aria-allowed-attr',
  'aria-allowed-role',
  'aria-required-attr',
  'aria-required-children',
  'aria-required-parent',
  'aria-valid-attr-value',
  'aria-hidden-focus',
  'label',
  'landmark-one-main',
  'heading-order',
  'duplicate-id-aria',
  'nested-interactive',
];

// Injected into the probe entries rather than the page, so axe arrives through
// vite's own resolution and the probe keeps answering /api itself. Appended, not
// prepended: `import './board-probe-net'` has to stay the first thing evaluated,
// because the api client captures globalThis.fetch when it initialises.
const injectAxe = {
  name: 'probe-inject-axe',
  // Ahead of vite's own transform, so this is appending to the probe's source
  // rather than to output that has already had its types stripped and its
  // imports resolved.
  enforce: 'pre',
  transform(code, id) {
    if (!/scripts\/(board|task-detail)-probe\.ts$/.test(id)) {
      return null;
    }
    return `${code}\nimport * as __axe from 'axe-core';\n(window as any).axe = __axe.default ?? __axe;\n`;
  },
};

async function startServer(plugins = []) {
  const created = await createServer({
    root: ROOT,
    logLevel: 'warn',
    plugins: [injectAxe, ...plugins],
    server: {
      host: '127.0.0.1',
      port: Number(process.env.A11Y_PROBE_PORT ?? '5200'),
      strictPort: false,
    },
  });
  await created.listen();
  return created;
}

const AUDIT = `(async () => {
  const results = await window.axe.run(document, {
    runOnly: { type: 'rule', values: ${JSON.stringify(RULES)} },
    resultTypes: ['violations'],
  });
  return results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => ({
      target: n.target.join(' '),
      summary: (n.failureSummary || '').split('\\n').filter(Boolean).slice(1).join(' | '),
    })),
    count: v.nodes.length,
  }));
})()`;

// Screens the gate covers. The board is the app's main surface; the overlay is a
// native <dialog>, which is where labelling and focus rules actually bite.
const SCREENS = [
  {
    name: 'board',
    page: 'scripts/board-probe.html?assignees=1',
    width: 1280,
    height: 900,
    mobile: false,
  },
  {
    name: 'board (mobile)',
    page: 'scripts/board-probe.html?assignees=1',
    width: 390,
    height: 844,
    mobile: true,
  },
  {
    name: 'card overlay',
    page: 'scripts/task-detail-probe.html',
    width: 1280,
    height: 900,
    mobile: false,
  },
];

const SCHEMES = ['light', 'dark'];

const browser = await createBrowser();
if (!browser) {
  console.warn('check:a11y — skipped (Playwright Chromium not installed).');
  console.warn('  Run `npm run playwright:install`.');
  process.exit(0);
}
const { setViewport, goto, eval: evalPage, close } = browser;

process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

/**
 * Audit every screen in every scheme.
 * @param {string} origin dev-server origin
 * @param {{mustPass?: boolean, only?: (screen: object) => boolean}} [options]
 * @returns {Promise<number>} count of cases that came out the wrong way
 */
async function runCases(origin, { mustPass = true, only, expect } = {}) {
  let bad = 0;
  for (const screen of SCREENS) {
    for (const scheme of SCHEMES) {
      if (only && !only(screen, scheme)) continue;
      // Recreating the context discards the page, so navigate after, never before.
      await setViewport({
        width: screen.width,
        height: screen.height,
        mobile: screen.mobile,
        colorScheme: scheme,
      });
      await goto(new URL(screen.page, origin).href, { wait: 600 });

      const ready = await evalPage('typeof window.axe');
      if (ready !== 'object' && ready !== 'function') {
        console.log(`  ✗ ${screen.name} / ${scheme}: axe never loaded (got ${ready})`);
        bad++;
        continue;
      }
      const violations = await evalPage(AUDIT);
      const label = `${screen.name} / ${scheme}`;
      if (violations.length === 0) {
        if (mustPass) {
          console.log(`  ✓ ${label}`);
        } else {
          console.log(`  ✗ ${label}: still clean with the fix removed`);
          bad++;
        }
        continue;
      }
      if (!mustPass) {
        const ids = violations.map((v) => v.id);
        if (expect !== undefined && !ids.includes(expect)) {
          console.log(`  ✗ ${label}: expected ${expect}, got ${ids.join(', ')}`);
          bad++;
          continue;
        }
        console.log(`  ✓ ${label}: caught ${ids.join(', ')}`);
        continue;
      }
      bad++;
      console.log(`  ✗ ${label}`);
      for (const v of violations) {
        console.log(
          `      ${v.id} (${v.impact}, ${v.count} node${v.count === 1 ? '' : 's'}) — ${v.help}`
        );
        for (const node of v.nodes) {
          console.log(`        ${node.target}`);
          if (node.summary) console.log(`          ${node.summary}`);
        }
      }
    }
  }
  return bad;
}

/**
 * A source rewrite that puts a component back on a bug, so the selftest can prove
 * this check would notice. Mirrors scripts/check-board-layout-real.mjs.
 */
function regression(name, file, substitutions) {
  const applied = substitutions.map(() => 0);
  return {
    plugin: {
      name: `a11y-selftest-${name}`,
      enforce: 'pre',
      transform(code, id) {
        if (!id.endsWith(file)) {
          return null;
        }
        return substitutions.reduce((source, [from, to], index) => {
          const next = source.replace(from, to);
          if (next !== source) {
            applied[index]++;
          }
          return next;
        }, code);
      },
    },
    report() {
      return applied
        .map((count, index) =>
          count === 1
            ? null
            : `rewrote "${substitutions[index][0]}" ${count} times (want exactly 1)`
        )
        .filter(Boolean);
    },
  };
}

async function runRegression({ plugin, report }, options) {
  const server = await startServer([plugin]);
  let bad = await runCases(server.resolvedUrls.local[0], { mustPass: false, ...options });
  for (const problem of report()) {
    bad++;
    console.log(`  ✗ the selftest ${problem}`);
  }
  await server.close();
  return bad;
}

let failed = 0;
const server = await startServer();
console.log('check:a11y — axe over the real components, both schemes');
failed += await runCases(server.resolvedUrls.local[0]);
await server.close();

if (SELFTEST) {
  // A clean axe run proves nothing until it is shown to go red on the bugs it
  // claims to hold: an audit that matched no nodes reports the same green.
  console.log('\ncheck:a11y --selftest — sensitivity');

  // The palette's dark half is the part a light-only run cannot see: indigo-500 as
  // text reaches only 4.01:1 on surface, which is why the dark accent moved a step
  // lighter and its on-colour flipped to compensate. Dark only — in light the
  // token is untouched and the case would pass for the wrong reason.
  failed += await runRegression(
    regression('dark-accent-contrast', 'src/app.css', [
      ['--cp-accent: #818cf8;', '--cp-accent: #6366f1;'],
    ]),
    {
      // The mobile board, where the bottom nav is on screen: its active link is
      // the probe's only text-accent, and at desktop width that nav is display:none
      // and so invisible to axe.
      only: (screen, scheme) => screen.mobile && scheme === 'dark',
      expect: 'color-contrast',
    }
  );

  // svelte-dnd-action puts role="listitem" on every child of a drop zone, which a
  // <section> — a landmark once it is named — may not carry.
  failed += await runRegression(
    regression('column-element', 'src/routes/Board.svelte', [
      [
        '<div\n          data-column-id={column.id}',
        '<section\n          data-column-id={column.id}',
      ],
      [
        '          {/if}\n        </div>\n      {/each}',
        '          {/if}\n        </section>\n      {/each}',
      ],
    ]),
    {
      only: (screen, scheme) => screen.name === 'board' && !screen.mobile && scheme === 'light',
      expect: 'aria-allowed-role',
    }
  );
}

await close();
if (failed > 0) {
  console.log(`\ncheck:a11y — FAILED (${failed})`);
  process.exit(1);
}
console.log('\ncheck:a11y — passed');
process.exit(0);
