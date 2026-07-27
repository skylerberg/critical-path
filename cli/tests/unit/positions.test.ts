import { describe, it, expect } from 'vitest';
import {
  append,
  spreadBetween,
  positionsForIndex,
  positionForPlacement,
  positionsForPlacement,
  prepend,
} from '../../src/positions';
import { CliError } from '../../src/api/errors';

describe('position math', () => {
  it('starts empty lists at 1000', () => {
    expect(append([])).toBe(1000);
    expect(prepend([])).toBe(1000);
    expect(positionsForIndex([], 5, 1)).toEqual([1000]);
  });

  it('appends at max + 1000 and prepends at min - 1000', () => {
    expect(append([1000, 3000])).toBe(4000);
    expect(prepend([1000, 3000])).toBe(0);
  });

  it('inserts at the midpoint of neighbors', () => {
    expect(positionsForIndex([1000, 2000], 1, 1)).toEqual([1500]);
    expect(spreadBetween(1000, 2000, 1)).toEqual([1500]);
  });

  it('fails when the midpoint has no room left', () => {
    expect(() => spreadBetween(1000, 1000 + Number.EPSILON, 1)).toThrow(CliError);
    expect(() => spreadBetween(1000, 1000, 1)).toThrow(/--top or --bottom/);
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

describe('positionsForPlacement', () => {
  const sorted = [
    { id: 'a', position: 1000 },
    { id: 'b', position: 2000 },
    { id: 'c', position: 3000 },
  ];
  const resolveAnchor = (ref: string) => ref;

  it('allocates one ascending block per placement', () => {
    expect(positionsForPlacement({}, sorted, resolveAnchor, 3)).toEqual([4000, 5000, 6000]);
    expect(positionsForPlacement({ top: true }, sorted, resolveAnchor, 3)).toEqual([
      -2000, -1000, 0,
    ]);
    expect(positionsForPlacement({ after: 'b' }, sorted, resolveAnchor, 3)).toEqual([
      2250, 2500, 2750,
    ]);
    expect(positionsForPlacement({ before: 'b' }, sorted, resolveAnchor, 3)).toEqual([
      1250, 1500, 1750,
    ]);
    expect(positionsForPlacement({}, [], resolveAnchor, 3)).toEqual([1000, 2000, 3000]);
  });

  it('keeps a 60-item block ascending and inside its neighbors', () => {
    for (const placement of [{ top: true }, { after: 'b' }]) {
      const positions = positionsForPlacement(placement, sorted, resolveAnchor, 60);
      expect(positions).toHaveLength(60);
      expect(positions.every((p, i) => i === 0 || p > positions[i - 1])).toBe(true);
    }

    const inserted = positionsForPlacement({ after: 'b' }, sorted, resolveAnchor, 60);
    expect(inserted[0]).toBeGreaterThan(2000);
    expect(inserted[59]).toBeLessThan(3000);
    expect(positionsForPlacement({ top: true }, sorted, resolveAnchor, 60)[59]).toBeLessThan(1000);
  });
});
