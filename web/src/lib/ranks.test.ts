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
} from './ranks';

function item(id: string, sortKey: string | null): Ranked {
  return { id, sort_key: sortKey };
}

function ranked(...items: Ranked[]): Ranked[] {
  return [...items].sort(byRank);
}

describe('byRank', () => {
  it('orders by key, then id', () => {
    expect(byRank(item('b', 'V0'), item('a', 'V1'))).toBeLessThan(0);
    expect(byRank(item('a', 'V0'), item('b', 'V0'))).toBeLessThan(0);
  });

  it('falls back to id when neither row is keyed', () => {
    expect(byRank(item('b', null), item('a', null))).toBeGreaterThan(0);
  });

  it('sorts a keyed row ahead of an unkeyed one', () => {
    expect(byRank(item('a', 'V0'), item('b', null))).toBeLessThan(0);
  });
});

describe('append', () => {
  it('ranks after everything already there', () => {
    const existing = ranked(item('a', 'V0'), item('b', 'V1'));
    const placed = append(existing);
    expect(byRank(item('x', placed.sort_key), existing[1]!)).toBeGreaterThan(0);
  });

  it('produces a usable rank from an empty list', () => {
    expect(append([]).sort_key.length).toBeGreaterThan(0);
  });

  it('appendRun keeps its own keys in order', () => {
    const run = appendRun([item('a', 'V0')], 3);
    const keys = run.map((p) => p.sort_key);
    expect([...keys].sort()).toEqual(keys);
    expect(byRank(item('x', keys[0]!), item('a', 'V0'))).toBeGreaterThan(0);
  });
});

describe('placeAtIndex', () => {
  const list = ranked(item('a', 'V0'), item('b', 'V1'), item('c', 'V2'));

  it('ranks before the first when index is 0', () => {
    const placed = placeAtIndex(list, 0);
    expect(byRank(item('x', placed.sort_key), list[0]!)).toBeLessThan(0);
  });

  it('ranks between the neighbours it lands on', () => {
    const placed = placeAtIndex(list, 1);
    const moved = item('x', placed.sort_key);
    expect(byRank(list[0]!, moved)).toBeLessThan(0);
    expect(byRank(moved, list[1]!)).toBeLessThan(0);
  });

  it('ranks after the last when index is past the end', () => {
    const placed = placeAtIndex(list, list.length);
    expect(byRank(item('x', placed.sort_key), list[2]!)).toBeGreaterThan(0);
  });
});

describe('between', () => {
  // The whole point of the key: a float midpoint collapses onto a neighbour
  // after ~50 rounds, and the key does not.
  it('never runs out of room against the same neighbour', () => {
    let low = item('a', 'V0');
    const high = item('z', 'V5');
    for (let step = 0; step < 500; step++) {
      const placed = between(low, high);
      const next = item(`x${step}`, placed.sort_key);
      expect(byRank(low, next)).toBeLessThan(0);
      expect(byRank(next, high)).toBeLessThan(0);
      low = next;
    }
  });
});

describe('reorderRankUpdates', () => {
  it('re-ranks only the moved item', () => {
    const ordered = [item('a', 'V0'), item('c', 'V2'), item('b', 'V1')];
    const updates = reorderRankUpdates(ordered, 'c');
    expect(updates.map((u) => u.id)).toEqual(['c']);
    const moved = item('c', updates[0]!.sort_key);
    expect(byRank(ordered[0]!, moved)).toBeLessThan(0);
    expect(byRank(moved, ordered[2]!)).toBeLessThan(0);
  });

  it('re-stamps the whole list when something has never been ranked', () => {
    const ordered = [item('a', 'V0'), item('b', null), item('c', 'V2')];
    expect(reorderRankUpdates(ordered, 'c').map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for an id that is not in the list', () => {
    expect(reorderRankUpdates([item('a', 'V0')], 'missing')).toEqual([]);
  });
});

describe('restack', () => {
  it('hands back ascending keys in the given order', () => {
    const updates = restack([item('c', null), item('a', null), item('b', null)]);
    expect(updates.map((u) => u.id)).toEqual(['c', 'a', 'b']);
    const keys = updates.map((u) => u.sort_key);
    expect([...keys].sort()).toEqual(keys);
  });
});
