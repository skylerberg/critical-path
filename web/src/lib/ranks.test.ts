import { describe, expect, it } from 'vitest';
import {
  append,
  appendRun,
  between,
  byRank,
  neighborsAfterDrop,
  placeAtIndex,
  placeBetweenNeighbors,
  reorderRankUpdates,
  restack,
  type Keyed,
  type Ranked,
} from './ranks';
import { placementAfterDrop } from './board.svelte';

// Overloaded so a keyed fixture is a `Keyed` and only an explicit null widens to
// `Ranked` — which is what lets the append family keep its non-null parameter
// without every test having to assert its own fixtures.
function item(id: string, sortKey: string): Keyed;
function item(id: string, sortKey: string | null): Ranked;
function item(id: string, sortKey: string | null): Ranked {
  return { id, sort_key: sortKey };
}

function ranked(...items: Keyed[]): Keyed[] {
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

describe('the Keyed requirement on the append family', () => {
  // Compile-time only, and never executed: `@ts-expect-error` fails `npm run
  // check` if any of these ever start type-checking, which is the entire guard.
  // An unkeyed row sorts last, so `extreme(items, true)` hands it back as the
  // maximum and the generated key sorts *before* every real one — the card goes
  // to the top of the column instead of the bottom, with no error anywhere.
  it('will not take a list that may be unkeyed', () => {
    const rows: Ranked[] = [item('a', null)];
    const neverRun = (): void => {
      // @ts-expect-error - append takes Keyed[]
      append(rows);
      // @ts-expect-error - appendRun takes Keyed[]
      appendRun(rows, 1);
      // @ts-expect-error - placeAtIndex takes Keyed[]
      placeAtIndex(rows, 0);
      // @ts-expect-error - placeBetweenNeighbors takes Keyed[]
      placeBetweenNeighbors(rows, { afterId: null, beforeId: null });
    };
    expect(neverRun).toBeTypeOf('function');
  });

  // The repair path still takes them, which is the point of it.
  it('still lets restack and reorderRankUpdates see an unkeyed row', () => {
    const rows: Ranked[] = [item('a', null), item('b', 'V0')];
    expect(restack(rows)).toHaveLength(2);
    expect(reorderRankUpdates(rows, 'a')).toHaveLength(2);
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

  it('ranks between the neighbors it lands on', () => {
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
  // The whole point of the key: a float midpoint collapses onto a neighbor
  // after ~50 rounds, and the key does not.
  it('never runs out of room against the same neighbor', () => {
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

describe('neighbors as the durable form of a drop', () => {
  const rows = (...keys: string[]) =>
    keys.map((sort_key, index) => ({ id: `t${String(index)}`, sort_key }));

  it('names the cards either side of the drop', () => {
    const items = rows('V0', 'V1', 'V2');
    // Moving the last card into the middle.
    const display = [items[0]!, items[2]!, items[1]!];
    expect(neighborsAfterDrop(display, 't2')).toEqual({ afterId: 't0', beforeId: 't1' });
  });

  it('has no anchor above it at the top of the list', () => {
    const items = rows('V0', 'V1');
    expect(neighborsAfterDrop([items[1]!, items[0]!], 't1')).toEqual({
      afterId: null,
      beforeId: 't0',
    });
  });

  it('has no anchor below it at the end of the list', () => {
    const items = rows('V0', 'V1');
    expect(neighborsAfterDrop(items, 't1')).toEqual({ afterId: 't0', beforeId: null });
  });

  // The property that makes a queued move survive: what gets sent now and what
  // gets replayed later describe the same drop.
  it('agrees with the placement computed at drop time', () => {
    const items = rows('V0', 'V1', 'V2');
    const display = [items[0]!, items[2]!, items[1]!];
    const others = display.filter((item) => item.id !== 't2');
    expect(placeBetweenNeighbors(others, neighborsAfterDrop(display, 't2'))).toEqual({
      placement: placementAfterDrop(display, 't2'),
      exact: true,
    });
  });
});

describe('placeBetweenNeighbors', () => {
  it('lands between both anchors when both are still there', () => {
    const result = placeBetweenNeighbors(
      [
        { id: 'a', sort_key: 'V0' },
        { id: 'b', sort_key: 'V1' },
      ],
      { afterId: 'a', beforeId: 'b' }
    );
    expect(result.exact).toBe(true);
    expect(result.placement.sort_key > 'V0' && result.placement.sort_key < 'V1').toBe(true);
  });

  it('keeps the intent when only one anchor survived', () => {
    const result = placeBetweenNeighbors(
      [
        { id: 'a', sort_key: 'V0' },
        { id: 'c', sort_key: 'V5' },
      ],
      { afterId: 'a', beforeId: 'gone' }
    );
    expect(result.exact).toBe(true);
    expect(result.placement.sort_key > 'V0' && result.placement.sort_key < 'V5').toBe(true);
  });

  // Reported rather than silently landing somewhere arbitrary.
  it('is inexact when the cards it was dropped between are both gone', () => {
    const result = placeBetweenNeighbors([{ id: 'c', sort_key: 'V5' }], {
      afterId: 'gone',
      beforeId: 'also-gone',
    });
    expect(result.exact).toBe(false);
    expect(result.placement.sort_key > 'V5').toBe(true);
  });

  it('is exact when the end of the list is what was actually asked for', () => {
    const result = placeBetweenNeighbors([{ id: 'c', sort_key: 'V5' }], {
      afterId: null,
      beforeId: null,
    });
    expect(result.exact).toBe(true);
  });
});
