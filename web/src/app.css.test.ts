import { describe, expect, it } from 'vitest';
import { cssBlock, cssTokens } from './lib/app-css-test-source';

const reducedMotion = cssBlock('@media (prefers-reduced-motion: reduce)');

// Tailwind emits nothing and raises no error for a candidate whose @utility is
// missing, so a className assertion alone would survive deleting this block.
describe('touch-callout-none utility', () => {
  it('turns off the native long-press callout', () => {
    expect(cssBlock('@utility touch-callout-none')).toMatch(/-webkit-touch-callout:\s*none/);
  });
});

// Same reason, and it is the whole guard for these: the component tests assert
// `focus-ring-inset` is in a classList, which stays true with the block below
// deleted — Tailwind would emit no rule, raise nothing, and the row would focus
// with no ring at all.
describe('focus ring utilities', () => {
  const offsets = { 'focus-ring': '2px', 'focus-ring-flush': '0', 'focus-ring-inset': '-2px' };

  for (const [name, offset] of Object.entries(offsets)) {
    it(`${name} draws the shared ring`, () => {
      // The trailing brace separates `focus-ring` from the two that extend its name.
      const block = cssBlock(`@utility ${name} {`);

      // Keyboard focus only: without the variant every one of these would ring
      // on a mouse click too, and each property below would still be present.
      expect(block).toContain('focus-visible');
      expect(block).toContain('outline-width: 2px');
      expect(block).toContain('outline-style: solid');
      expect(block).toContain('outline-color: var(--cp-accent)');
      expect(block).toContain(`outline-offset: ${offset}`);
    });
  }
});

describe('reduced-motion stylesheet rule', () => {
  it('targets every element and pseudo-element', () => {
    expect(reducedMotion).toContain('*,');
    expect(reducedMotion).toContain('*::before');
    expect(reducedMotion).toContain('*::after');
  });

  it.each([
    'animation-duration',
    'animation-delay',
    'animation-iteration-count',
    'transition-duration',
    'transition-delay',
    'scroll-behavior',
  ])('forces %s with !important inside the media block', (property) => {
    expect(reducedMotion).toMatch(new RegExp(`${property}:[^;]*!important`));
  });
});

describe('design token mapping', () => {
  const theme = cssBlock('@theme inline');
  const light = cssTokens('light');
  const dark = cssTokens('dark');

  it.each([
    'canvas',
    'surface',
    'edge',
    'ink',
    'muted',
    'accent',
    'accent-strong',
    'accent-soft',
    'on-accent',
    'danger',
    'on-danger',
    'success',
    'warning',
  ])('maps --color-%s onto the token of the same name in both themes', (name) => {
    expect(theme).toContain(`--color-${name}: var(--cp-${name});`);
    expect(light[`--cp-${name}`]).toMatch(/^#[0-9a-f]{6}$/);
    expect(dark[`--cp-${name}`]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('crosses no wires: every mapping names its own token', () => {
    for (const [, color, token] of theme.matchAll(/--color-([a-z-]+):\s*var\(--cp-([a-z-]+)\)/g)) {
      expect(token).toBe(color);
    }
  });
});
