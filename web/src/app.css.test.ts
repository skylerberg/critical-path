import { describe, expect, it } from 'vitest';
import { cssBlock } from './lib/app-css-test-source';

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
