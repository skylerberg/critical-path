import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

// Every assertion about an ordering compares two scores for the SAME query.
// Across queries the numbers mean nothing: the scale has no per-character term.
function score(query: string, text: string): number {
  const value = fuzzyScore(query, text);
  if (value === null) {
    throw new Error(`expected "${query}" to match "${text}"`);
  }
  return value;
}

describe('fuzzyScore', () => {
  it('matches characters in order with gaps between them', () => {
    expect(fuzzyScore('mkdn', 'Mark done')).not.toBeNull();
    expect(fuzzyScore('blkby', 'Blocked by…')).not.toBeNull();
    expect(fuzzyScore('cpl', 'Copy link')).not.toBeNull();
  });

  it('is a miss when a character is absent or out of order', () => {
    expect(fuzzyScore('mkdz', 'Mark done')).toBeNull();
    expect(fuzzyScore('done mark', 'Mark done')).toBeNull();
  });

  it('does not forgive a transposition', () => {
    expect(fuzzyScore('lables', 'Labels…')).toBeNull();
    expect(fuzzyScore('labels', 'Labels…')).not.toBeNull();
  });

  it('is case-insensitive', () => {
    expect(score('MK', 'Mark done')).toBe(score('mk', 'mark done'));
  });

  it('ignores whitespace in the query, so a typed word break still matches', () => {
    expect(fuzzyScore('proj a', 'Project Alpha')).not.toBeNull();
    expect(score('mk dn', 'Mark done')).toBe(score('mkdn', 'Mark done'));
  });

  it('is a miss when the query is longer than the text', () => {
    expect(fuzzyScore('archive', 'arch')).toBeNull();
  });

  it('scores every text on an empty query, which the callers rank as a tie', () => {
    expect(fuzzyScore('', 'Anything')).toBe(0);
    expect(fuzzyScore('   ', 'Anything')).toBe(0);
  });

  it('ranks a consecutive run above the same characters scattered', () => {
    expect(score('abc', 'abcdefgh')).toBeGreaterThan(score('abc', 'a-b-c-defgh'));
  });

  it('ranks word starts above characters buried mid-word', () => {
    expect(score('ab', 'Alpha Beta')).toBeGreaterThan(score('ab', 'Salsa verbena'));
  });

  it('reads a camel hump as a word start', () => {
    expect(score('ab', 'AlphaBeta')).toBeGreaterThan(score('ab', 'Alphabeta'));
  });

  it('takes the best alignment, not the first one a greedy scan would find', () => {
    // The leading 'a' is a decoy: the pair at the end is the better read, and a
    // greedy scan spends the 'a' on index 0 and never sees it. Scoring the same
    // as the text without the decoy is what says the search looked past it.
    expect(score('ab', 'a zzzz ab')).toBe(score('ab', 'z zzzz ab'));
  });

  // Project, column and label names are user-supplied and reach this verbatim,
  // and 'İ' (U+0130) lowercases to two code units: a scan string longer than the
  // text it is aligned with used to walk the boundary test off the end and throw.
  it('keeps its two indexes aligned when lowercasing lengthens a character', () => {
    expect(() => fuzzyScore('is', 'İstanbul Boss')).not.toThrow();
    expect(fuzzyScore('ib', 'İstanbul Boss')).not.toBeNull();
    expect(score('b', 'İstanbul Boss')).toBe(score('b', 'Istanbul Boss'));
  });

  it('punishes a late start, but not without bound', () => {
    const early = score('x', `x${'-'.repeat(30)}`);
    const late = score('x', `${'-'.repeat(20)}x`);
    const later = score('x', `${'-'.repeat(40)}x`);

    expect(late).toBeLessThan(early);
    expect(later).toBe(late);
  });
});
