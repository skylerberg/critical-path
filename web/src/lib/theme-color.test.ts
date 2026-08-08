import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCENTS, ACCENT_KEYS } from './accents';
import { ThemeColor } from './theme-color';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const ACCENT = '--cp-accent';
const CANVAS = '--cp-canvas';
// Deliberately not one of the palette's hexes, so a test that expects the tag's
// own value back cannot pass on a token that happens to resolve to the same thing.
const SHIPPED = '#abcdef';

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
const [lightSource = '', afterDark = ''] = css.split(`@media ${DARK_QUERY}`);
const [darkSource = ''] = afterDark.split('@theme inline');

function hexes(source: string): Map<string, string> {
  const pairs = [...source.matchAll(/(--cp-[a-z-]+):\s*(#[0-9a-f]{6})/g)];
  return new Map(pairs.map(([, name, hex]) => [name!, hex!]));
}

// jsdom resolves no custom property declared inside a media query — and, with
// Tailwind's @import unprocessed, none of the others either — so the browser's
// half of the job is played by the stylesheet's own text.
const PALETTE = { light: hexes(lightSource), dark: hexes(darkSource) };

function token(name: string, theme: 'light' | 'dark'): string {
  const hex = PALETTE[theme].get(name);
  expect(`${theme} ${name}: ${hex}`).toMatch(/: #[0-9a-f]{6}$/);
  return hex!;
}

interface Registration {
  type: string;
  listener: () => void;
}

let scheme: 'light' | 'dark';
let meta: HTMLMetaElement | null;
let queries: string[];
let added: Registration[];
let removed: Registration[];
let instances: ThemeColor[];

function start(): ThemeColor {
  const instance = new ThemeColor();
  instances.push(instance);
  instance.init();
  return instance;
}

beforeEach(() => {
  scheme = 'light';
  queries = [];
  added = [];
  removed = [];
  instances = [];
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = SHIPPED;
  document.head.appendChild(meta);
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => PALETTE[scheme].get(name) ?? '',
  }));
  vi.stubGlobal('matchMedia', (query: string) => {
    queries.push(query);
    return {
      matches: scheme === 'dark',
      addEventListener: (type: string, listener: () => void) => added.push({ type, listener }),
      removeEventListener: (type: string, listener: () => void) => removed.push({ type, listener }),
    };
  });
});

afterEach(() => {
  for (const instance of instances.splice(0)) {
    instance.dispose();
  }
  meta?.remove();
  vi.unstubAllGlobals();
});

describe('ThemeColor', () => {
  it('paints every palette key with the hex the stylesheet gives it, in both schemes', () => {
    for (const key of ACCENT_KEYS) {
      for (const theme of ['light', 'dark'] as const) {
        scheme = theme;
        const themeColor = start();

        themeColor.set(key);

        expect(`${theme} ${key}: ${meta!.content}`).toBe(
          `${theme} ${key}: ${token(ACCENTS[key].cssVar, theme)}`
        );
      }
    }
  });

  it('paints the app accent for a board that has none, in both schemes', () => {
    for (const theme of ['light', 'dark'] as const) {
      scheme = theme;

      start();

      expect(`${theme}: ${meta!.content}`).toBe(`${theme}: ${token(ACCENT, theme)}`);
    }
  });

  it('hands the app accent back once a board colour is cleared', () => {
    const themeColor = start();

    themeColor.set('amber');
    expect(meta!.content).toBe(token(ACCENTS.amber.cssVar, 'light'));

    themeColor.reset();
    expect(meta!.content).toBe(token(ACCENT, 'light'));
  });

  // Undefined is the drag placeholder; an unknown key is a newer release's palette.
  it('falls back to the app accent for a colour it has no token for', () => {
    const themeColor = start();

    themeColor.set('chartreuse');
    expect(meta!.content).toBe(token(ACCENT, 'light'));

    themeColor.set(undefined);
    expect(meta!.content).toBe(token(ACCENT, 'light'));
  });

  it('repaints an open board when the scheme flips under a page that never re-renders', () => {
    const themeColor = start();
    themeColor.set('sky');

    expect(queries).toEqual([DARK_QUERY]);
    expect(added).toHaveLength(1);
    expect(added[0]!.type).toBe('change');
    expect(meta!.content).toBe(token(ACCENTS.sky.cssVar, 'light'));

    scheme = 'dark';
    added[0]!.listener();

    expect(meta!.content).toBe(token(ACCENTS.sky.cssVar, 'dark'));
  });

  // The listener outlives reset() on purpose: with no board open the tag still
  // tracks a token that has two values.
  it('repaints the default when the scheme flips with no board open', () => {
    const themeColor = start();
    themeColor.set('sky');
    themeColor.reset();

    scheme = 'dark';
    added[0]!.listener();

    expect(meta!.content).toBe(token(ACCENT, 'dark'));
    expect(removed).toHaveLength(0);
  });

  it('keeps one listener across a change of colour', () => {
    const themeColor = start();

    themeColor.set('sky');
    themeColor.set('rose');

    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
    expect(meta!.content).toBe(token(ACCENTS.rose.cssVar, 'light'));
  });

  it('removes the exact listener it registered and tolerates a second dispose', () => {
    const themeColor = start();

    themeColor.dispose();

    expect(removed).toHaveLength(1);
    expect(removed[0]!.type).toBe('change');
    expect(removed[0]!.listener).toBe(added[0]!.listener);

    themeColor.dispose();
    expect(removed).toHaveLength(1);
  });

  it('trims the whitespace an engine keeps around a custom property', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '  #123456\n' }));

    start().set('amber');

    expect(meta!.content).toBe('#123456');
  });

  it("keeps the document's own colour when a token resolves to nothing", () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }));

    start().set('amber');

    expect(meta!.content).toBe(SHIPPED);
  });

  it('does nothing when the document carries no theme-color tag', () => {
    meta!.remove();
    meta = null;

    expect(() => start().set('amber')).not.toThrow();
  });

  it('still paints where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);

    start().set('amber');

    expect(meta!.content).toBe(token(ACCENTS.amber.cssVar, 'light'));
  });
});

// The manifest is precached by the service worker and read at install time, so
// its colour cannot follow a board or a scheme the way the meta tag does. Both
// duplicate app.css by hand instead; these pin the copies to the source.
describe('the chrome colours shipped ahead of the stylesheet', () => {
  const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

  it('paints the pre-JS address bar with the light accent', () => {
    const shipped = /<meta name="theme-color" content="(#[0-9a-f]{6})"/.exec(indexHtml)?.[1];

    expect(shipped).toBe(token(ACCENT, 'light'));
  });

  it('installs the PWA with the light accent and canvas', () => {
    const themeColor = /theme_color: '(#[0-9a-f]{6})'/.exec(viteConfig)?.[1];
    const backgroundColor = /background_color: '(#[0-9a-f]{6})'/.exec(viteConfig)?.[1];

    expect(themeColor).toBe(token(ACCENT, 'light'));
    expect(backgroundColor).toBe(token(CANVAS, 'light'));
  });
});
