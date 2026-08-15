import { describe, expect, it } from 'vitest';
import { ACCENTS, ACCENT_KEYS, accentVar } from './accents';
import { contrast, cssTokens } from './app-css-test-source';

// Every background an accent is ever painted on: the header and sidebar sit on
// surface, the projects grid on canvas, and a selected or hovered sidebar row
// swaps to accent-soft underneath the dot.
const BACKGROUNDS = ['--cp-surface', '--cp-canvas', '--cp-accent-soft'];

describe('project accent palette', () => {
  it('gives every palette key a value in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const values = cssTokens(theme);
      const defined = ACCENT_KEYS.filter((key) => values[ACCENTS[key].cssVar] !== undefined);
      expect(defined).toEqual(ACCENT_KEYS);
      for (const name of BACKGROUNDS) {
        expect(values[name]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // The accent is fill only — never a text color and never drawn on — so 3:1 is
  // the whole bar. Several entries fall under the 4.5:1 text threshold, which is
  // why nothing may be written on top of one.
  it('clears 3:1 against every background it is drawn on, in both themes', () => {
    const failures: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      const values = cssTokens(theme);
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
  // colored, and an unknown key is a newer release's palette entry.
  it('resolves undefined, null and an unknown key to nothing', () => {
    expect(accentVar(undefined)).toBeNull();
    expect(accentVar(null)).toBeNull();
    expect(accentVar('chartreuse')).toBeNull();
    expect(accentVar('toString')).toBeNull();
  });
});
