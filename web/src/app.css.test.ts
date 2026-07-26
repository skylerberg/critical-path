import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read off disk, not imported: a `?raw` import would go through the Tailwind
// transform, and `new URL('./app.css', import.meta.url)` is rewritten by Vite
// into an asset reference before it ever reaches fs.
const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8');

describe('reduced-motion stylesheet rule', () => {
  it('declares a prefers-reduced-motion block', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it.each([
    'animation-duration',
    'animation-delay',
    'animation-iteration-count',
    'transition-duration',
    'transition-delay',
    'scroll-behavior',
  ])('forces %s with !important', (property) => {
    expect(css).toMatch(new RegExp(`${property}:[^;]*!important`));
  });
});
