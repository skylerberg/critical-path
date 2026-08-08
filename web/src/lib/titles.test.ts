import { describe, expect, it } from 'vitest';
import { TASK_TITLE_MAX_LENGTH, TITLE_DISPLAY_LIMIT, truncateTitle } from './titles';

describe('truncateTitle', () => {
  it('leaves a title at the limit untouched', () => {
    const title = 'x'.repeat(TITLE_DISPLAY_LIMIT);
    expect(truncateTitle(title)).toBe(title);
  });

  it('clips one character past the limit and marks the elision', () => {
    const shown = truncateTitle('x'.repeat(TITLE_DISPLAY_LIMIT + 1));
    expect(shown).toBe(`${'x'.repeat(TITLE_DISPLAY_LIMIT)}…`);
    expect([...shown]).toHaveLength(TITLE_DISPLAY_LIMIT + 1);
  });

  it('clips the longest storable title to the display limit', () => {
    expect([...truncateTitle('x'.repeat(TASK_TITLE_MAX_LENGTH))]).toHaveLength(
      TITLE_DISPLAY_LIMIT + 1
    );
  });

  it('drops trailing whitespace so the ellipsis sits against the text', () => {
    expect(truncateTitle(`${'x'.repeat(TITLE_DISPLAY_LIMIT - 2)}a  bcd`)).toBe(
      `${'x'.repeat(TITLE_DISPLAY_LIMIT - 2)}a…`
    );
  });

  it('never splits a surrogate pair', () => {
    const shown = truncateTitle('🎲'.repeat(TITLE_DISPLAY_LIMIT + 1));
    expect(shown).toBe(`${'🎲'.repeat(TITLE_DISPLAY_LIMIT)}…`);
    expect(shown).not.toContain('�');
  });

  it('measures code points, so emoji are not cut at half the limit', () => {
    const title = '🎲'.repeat(TITLE_DISPLAY_LIMIT);
    expect(title.length).toBeGreaterThan(TITLE_DISPLAY_LIMIT);
    expect(truncateTitle(title)).toBe(title);
  });

  it('honors a caller-supplied limit', () => {
    expect(truncateTitle('abcdef', 3)).toBe('abc…');
  });
});
