import { describe, expect, it } from 'vitest';
import { append, between, positionForIndex, prepend } from './positions';

describe('between', () => {
  it('returns the midpoint of two neighbors', () => {
    expect(between(1000, 2000)).toBe(1500);
    expect(between(-1000, 1000)).toBe(0);
  });
});

describe('append', () => {
  it('returns 1000 for an empty list', () => {
    expect(append([])).toBe(1000);
  });

  it('returns max + 1000', () => {
    expect(append([1000, 3000, 2000])).toBe(4000);
  });
});

describe('prepend', () => {
  it('returns 1000 for an empty list', () => {
    expect(prepend([])).toBe(1000);
  });

  it('returns min - 1000', () => {
    expect(prepend([1000, 3000, 2000])).toBe(0);
  });
});

describe('positionForIndex', () => {
  it('returns 1000 for an empty list', () => {
    expect(positionForIndex([], 0)).toBe(1000);
  });

  it('prepends at index 0', () => {
    expect(positionForIndex([1000, 2000], 0)).toBe(0);
  });

  it('appends past the end', () => {
    expect(positionForIndex([1000, 2000], 2)).toBe(3000);
  });

  it('takes the midpoint between neighbors', () => {
    expect(positionForIndex([1000, 2000, 4000], 1)).toBe(1500);
    expect(positionForIndex([1000, 2000, 4000], 2)).toBe(3000);
  });
});
