import { describe, it, expect } from 'vitest';
import {
  append,
  between,
  positionForIndex,
  positionForPlacement,
  prepend,
} from '../../src/positions';
import { CliError } from '../../src/api/errors';

describe('position math', () => {
  it('starts empty lists at 1000', () => {
    expect(append([])).toBe(1000);
    expect(prepend([])).toBe(1000);
    expect(positionForIndex([], 5)).toBe(1000);
  });

  it('appends at max + 1000 and prepends at min - 1000', () => {
    expect(append([1000, 3000])).toBe(4000);
    expect(prepend([1000, 3000])).toBe(0);
  });

  it('inserts at the midpoint of neighbors', () => {
    expect(positionForIndex([1000, 2000], 1)).toBe(1500);
    expect(between(1000, 2000)).toBe(1500);
  });

  it('fails when the midpoint has no room left', () => {
    expect(() => between(1000, 1000 + Number.EPSILON)).toThrow(CliError);
    expect(() => between(1000, 1000)).toThrow(/--top or --bottom/);
  });
});

describe('positionForPlacement', () => {
  const sorted = [
    { id: 'a', position: 1000 },
    { id: 'b', position: 2000 },
    { id: 'c', position: 3000 },
  ];
  const resolveAnchor = (ref: string) => ref;

  it('defaults to the bottom', () => {
    expect(positionForPlacement({}, sorted, resolveAnchor)).toBe(4000);
  });

  it('places at the top', () => {
    expect(positionForPlacement({ top: true }, sorted, resolveAnchor)).toBe(0);
  });

  it('places before and after an anchor', () => {
    expect(positionForPlacement({ before: 'b' }, sorted, resolveAnchor)).toBe(1500);
    expect(positionForPlacement({ after: 'b' }, sorted, resolveAnchor)).toBe(2500);
    expect(positionForPlacement({ after: 'c' }, sorted, resolveAnchor)).toBe(4000);
    expect(positionForPlacement({ before: 'a' }, sorted, resolveAnchor)).toBe(0);
  });

  it('rejects conflicting placement flags', () => {
    expect(() => positionForPlacement({ top: true, before: 'b' }, sorted, resolveAnchor)).toThrow(
      /at most one/
    );
  });
});
