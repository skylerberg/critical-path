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
