import { describe, expect, it } from 'vitest';
import {
  append,
  appendRun,
  between,
  byRank,
  placeAtIndex,
  reorderRankUpdates,
  restack,
  type Ranked,
} from './positions';

function item(id: string, position: number, sortKey: string | null): Ranked {
  return { id, position, sort_key: sortKey };
}

function ranked(...items: Ranked[]): Ranked[] {
  return [...items].sort(byRank);
}

describe('byRank', () => {
  it('orders by key, then id', () => {
    expect(byRank(item('b', 9999, 'V0'), item('a', 1, 'V1'))).toBeLessThan(0);
    expect(byRank(item('a', 0, 'V0'), item('b', 0, 'V0'))).toBeLessThan(0);
  });

  it('falls back to position only when neither row is keyed', () => {
    expect(byRank(item('a', 2000, null), item('b', 1000, null))).toBeGreaterThan(0);
  });

  it('sorts a keyed row ahead of an unkeyed one', () => {
    expect(byRank(item('a', 9999, 'V0'), item('b', 1, null))).toBeLessThan(0);
  });
});

describe('append', () => {
  it('ranks after everything already there', () => {
    const existing = ranked(item('a', 1000, 'V0'), item('b', 2000, 'V1'));
    const placed = append(existing);
    expect(placed.position).toBe(3000);
    expect(byRank(item('x', placed.position, placed.sort_key), existing[1]!)).toBeGreaterThan(0);
  });

  it('produces a usable rank from an empty list', () => {
    const placed = append([]);
    expect(placed.position).toBe(1000);
    expect(placed.sort_key.length).toBeGreaterThan(0);
  });

  it('appendRun keeps its own keys in order', () => {
    const run = appendRun([item('a', 1000, 'V0')], 3);
    expect(run.map((p) => p.position)).toEqual([2000, 3000, 4000]);
    expect([...run.map((p) => p.sort_key)].sort()).toEqual(run.map((p) => p.sort_key));
  });
});

describe('placeAtIndex', () => {
  const list = ranked(item('a', 1000, 'V0'), item('b', 2000, 'V1'), item('c', 3000, 'V2'));

  it('ranks before the first when index is 0', () => {
    const placed = placeAtIndex(list, 0);
    expect(byRank(item('x', placed.position, placed.sort_key), list[0]!)).toBeLessThan(0);
  });

  it('ranks between the neighbours it lands on', () => {
    const placed = placeAtIndex(list, 1);
    const moved = item('x', placed.position, placed.sort_key);
    expect(byRank(list[0]!, moved)).toBeLessThan(0);
    expect(byRank(moved, list[1]!)).toBeLessThan(0);
  });

  it('ranks after the last when index is past the end', () => {
    const placed = placeAtIndex(list, list.length);
    expect(byRank(item('x', placed.position, placed.sort_key), list[2]!)).toBeGreaterThan(0);
  });
});

describe('between', () => {
  // The whole point of the key: the float half of this placement collapses onto
  // a neighbour after ~50 rounds, and the key does not.
  it('never runs out of room against the same neighbour', () => {
    let low = item('a', 0, 'V0');
    const high = item('z', 100000, 'V5');
    for (let step = 0; step < 500; step++) {
      const placed = between(low, high);
      const next = item(`x${step}`, placed.position, placed.sort_key);
      expect(byRank(low, next)).toBeLessThan(0);
      expect(byRank(next, high)).toBeLessThan(0);
      low = next;
    }
  });
});

describe('reorderRankUpdates', () => {
  it('re-ranks only the moved item', () => {
    const ordered = [item('a', 1000, 'V0'), item('c', 3000, 'V2'), item('b', 2000, 'V1')];
    const updates = reorderRankUpdates(ordered, 'c');
    expect(updates.map((u) => u.id)).toEqual(['c']);
    const moved = item('c', updates[0]!.position, updates[0]!.sort_key);
    expect(byRank(ordered[0]!, moved)).toBeLessThan(0);
    expect(byRank(moved, ordered[2]!)).toBeLessThan(0);
  });

  it('re-stamps the whole list when something has never been ranked', () => {
    const ordered = [item('a', 1000, 'V0'), item('b', 2000, null), item('c', 3000, 'V2')];
    expect(reorderRankUpdates(ordered, 'c').map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for an id that is not in the list', () => {
    expect(reorderRankUpdates([item('a', 1000, 'V0')], 'missing')).toEqual([]);
  });
});

describe('restack', () => {
  it('hands back evenly spaced ranks in the given order', () => {
    const updates = restack([item('c', 5, null), item('a', 9, null), item('b', 1, null)]);
    expect(updates.map((u) => u.id)).toEqual(['c', 'a', 'b']);
    expect(updates.map((u) => u.position)).toEqual([1000, 2000, 3000]);
    const keys = updates.map((u) => u.sort_key);
    expect([...keys].sort()).toEqual(keys);
  });
});
