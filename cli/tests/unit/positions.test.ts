import { describe, expect, it } from 'vitest';
import {
  byRank,
  keyForPlacement,
  keysForIndex,
  keysForPlacement,
  placementIndex,
  spreadBetween,
  type Ranked,
} from '../../src/positions';
import { CliError } from '../../src/api/errors';

function ranked(id: string, sortKey: string): Ranked {
  return { id, sort_key: sortKey };
}

const list = [ranked('a', 'V0'), ranked('b', 'V1'), ranked('c', 'V2')];
const anchor = (ref: string): string => ref;

describe('keysForIndex', () => {
  it('ranks before the first', () => {
    expect(keysForIndex(list, 0, 1)[0]! < 'V0').toBe(true);
  });

  it('ranks between neighbours', () => {
    const key = keysForIndex(list, 1, 1)[0]!;
    expect(key > 'V0' && key < 'V1').toBe(true);
  });

  it('ranks after the last', () => {
    expect(keysForIndex(list, list.length, 1)[0]! > 'V2').toBe(true);
  });

  it('ranks into an empty list', () => {
    expect(keysForIndex([], 0, 1)[0]).toBeTruthy();
  });
});

describe('spreadBetween', () => {
  // The float scheme threw here once a gap ran out; a run of keys never does.
  it('spreads a run between two neighbours, however many', () => {
    for (const count of [1, 5, 500]) {
      const keys = spreadBetween('V0', 'V1', count);
      expect(keys).toHaveLength(count);
      expect([...keys].sort()).toEqual(keys);
      expect(keys[0]! > 'V0').toBe(true);
      expect(keys[keys.length - 1]! < 'V1').toBe(true);
    }
  });
});

describe('placementIndex', () => {
  const ids = list.map((item) => item.id);

  it('reads each flag', () => {
    expect(placementIndex({ top: true }, ids, anchor)).toBe(0);
    expect(placementIndex({ bottom: true }, ids, anchor)).toBe(ids.length);
    expect(placementIndex({ before: 'b' }, ids, anchor)).toBe(1);
    expect(placementIndex({ after: 'b' }, ids, anchor)).toBe(2);
    expect(placementIndex({}, ids, anchor)).toBe(ids.length);
  });

  it('refuses two placements at once', () => {
    expect(() => placementIndex({ top: true, bottom: true }, ids, anchor)).toThrow(CliError);
  });
});

describe('keysForPlacement', () => {
  it('ranks a run where the placement points', () => {
    const keys = keysForPlacement({ after: 'a' }, list, anchor, 2);
    expect(keys[0]! > 'V0').toBe(true);
    expect(keys[1]! < 'V1').toBe(true);
  });

  it('keyForPlacement hands back the single key', () => {
    expect(keyForPlacement({ top: true }, list, anchor) < 'V0').toBe(true);
  });
});

describe('byRank', () => {
  it('orders by key, then id', () => {
    expect(byRank(ranked('z', 'V0'), ranked('a', 'V1'))).toBeLessThan(0);
    expect(byRank(ranked('a', 'V0'), ranked('b', 'V0'))).toBeLessThan(0);
  });
});
