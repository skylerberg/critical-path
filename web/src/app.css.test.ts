import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8');

function blockAt(prelude: string): string {
  const start = css.indexOf(prelude);
  if (start < 0) {
    throw new Error(`${prelude} is missing from app.css`);
  }
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') {
      depth += 1;
    } else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(start, i + 1);
      }
    }
  }
  throw new Error(`${prelude} has no closing brace`);
}

const reducedMotion = blockAt('@media (prefers-reduced-motion: reduce)');

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
