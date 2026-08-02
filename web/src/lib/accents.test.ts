import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENTS, ACCENT_KEYS, accentVar } from './accents';

const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');

const DARK_MARKER = '@media (prefers-color-scheme: dark)';
const THEME_MARKER = '@theme inline';

function block(theme: 'light' | 'dark'): Record<string, string> {
  const darkAt = css.indexOf(DARK_MARKER);
  const themeAt = css.indexOf(THEME_MARKER);
  expect(darkAt).toBeGreaterThan(0);
  expect(themeAt).toBeGreaterThan(darkAt);
  const source = theme === 'light' ? css.slice(0, darkAt) : css.slice(darkAt, themeAt);
  const values: Record<string, string> = {};
  for (const [, name, hex] of source.matchAll(/(--cp-[a-z-]+):\s*(#[0-9a-f]{6})/g)) {
    values[name] = hex;
  }
  return values;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

// Every background an accent is ever painted on: the header and sidebar sit on
// surface, the projects grid on canvas, and a selected or hovered sidebar row
// swaps to accent-soft underneath the dot.
const BACKGROUNDS = ['--cp-surface', '--cp-canvas', '--cp-accent-soft'];

describe('project accent palette', () => {
  it('gives every palette key a value in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const values = block(theme);
      const defined = ACCENT_KEYS.filter((key) => values[ACCENTS[key].cssVar] !== undefined);
      expect(defined).toEqual(ACCENT_KEYS);
      for (const name of BACKGROUNDS) {
        expect(values[name]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // The accent is fill only — never a text colour and never drawn on — so 3:1 is
  // the whole bar. Several entries fall under the 4.5:1 text threshold, which is
  // why nothing may be written on top of one.
  it('clears 3:1 against every background it is drawn on, in both themes', () => {
    const failures: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      const values = block(theme);
      for (const key of ACCENT_KEYS) {
        const accent = values[ACCENTS[key].cssVar]!;
        for (const name of BACKGROUNDS) {
          const ratio = contrast(accent, values[name]!);
          if (ratio < 3) {
            failures.push(`${theme} ${key} on ${name}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('resolves a known key to its token', () => {
    expect(accentVar('amber')).toBe('var(--cp-project-amber)');
    expect(accentVar('slate')).toBe('var(--cp-project-slate)');
  });

  // Undefined is the drag placeholder, null is every board that has never been
  // coloured, and an unknown key is a newer release's palette entry.
  it('resolves undefined, null and an unknown key to nothing', () => {
    expect(accentVar(undefined)).toBeNull();
    expect(accentVar(null)).toBeNull();
    expect(accentVar('chartreuse')).toBeNull();
    expect(accentVar('toString')).toBeNull();
  });
});
