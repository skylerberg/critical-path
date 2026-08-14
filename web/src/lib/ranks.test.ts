import { describe, expect, it } from 'vitest';
import {
  append,
  appendRun,
  between,
  byRank,
  neighborsAfterDrop,
  neighborsAtIndex,
  placeAtIndex,
  placeBetweenNeighbors,
  reorderRankUpdates,
  restack,
  type Keyed,
  type Ranked,
} from './ranks';
import { placementAfterDrop } from './board.svelte';
import { testSortKey } from './test-ids';

// Positional sort keys, ascending: k(0) < k(1) < k(2). Generated rather than
// written out, because `ranks.ts` passes BASE_62_DIGITS and most strings are not
// legal keys under it — an invalid one throws from inside the library as an
// unhandled rejection naming whichever test happened to be running.
const k = testSortKey;

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
    expect(byRank(item('b', k(0)), item('a', k(1)))).toBeLessThan(0);
    expect(byRank(item('a', k(0)), item('b', k(0)))).toBeLessThan(0);
  });

  it('falls back to id when neither row is keyed', () => {
    expect(byRank(item('b', null), item('a', null))).toBeGreaterThan(0);
  });

  it('sorts a keyed row ahead of an unkeyed one', () => {
    expect(byRank(item('a', k(0)), item('b', null))).toBeLessThan(0);
  });

  // The same contract with the unkeyed row on the left. Deleting that arm is
  // invisible — `null < 'V0…'` is false, so the key comparison below returns the
  // same 1 — which is why the guard on it flips the sign rather than removing it.
  it('sorts an unkeyed row after a keyed one, whichever side it is on', () => {
    expect(byRank(item('a', null), item('b', k(0)))).toBeGreaterThan(0);

    const rows: Ranked[] = [item('a', null), item('b', k(0))];
    expect([...rows].sort(byRank).map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('the Keyed requirement on the append family', () => {
  // Compile-time only, and never executed: `@ts-expect-error` fails `pnpm run
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
      placeBetweenNeighbors(rows, { kind: 'append' });
    };
    expect(neverRun).toBeTypeOf('function');
  });

  // The repair path still takes them, which is the point of it.
  it('still lets restack and reorderRankUpdates see an unkeyed row', () => {
    const rows: Ranked[] = [item('a', null), item('b', k(0))];
    expect(restack(rows)).toHaveLength(2);
    expect(reorderRankUpdates(rows, 'a')).toHaveLength(2);
  });
});

describe('append', () => {
  it('ranks after everything already there', () => {
    const existing = ranked(item('a', k(0)), item('b', k(1)));
    const placed = append(existing);
    expect(byRank(item('x', placed.sort_key), existing[1]!)).toBeGreaterThan(0);
  });

  it('produces a usable rank from an empty list', () => {
    expect(append([]).sort_key.length).toBeGreaterThan(0);
  });

  it('appendRun keeps its own keys in order', () => {
    const run = appendRun([item('a', k(0))], 3);
    const keys = run.map((p) => p.sort_key);
    expect([...keys].sort()).toEqual(keys);
    expect(byRank(item('x', keys[0]!), item('a', k(0)))).toBeGreaterThan(0);
  });
});

describe('placeAtIndex', () => {
  const list = ranked(item('a', k(0)), item('b', k(1)), item('c', k(2)));

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
    let low = item('a', k(0));
    const high = item('z', k(5));
    for (let step = 0; step < 500; step++) {
      const placed = between(low, high);
      const next = item(`x${step}`, placed.sort_key);
      expect(byRank(low, next)).toBeLessThan(0);
      expect(byRank(next, high)).toBeLessThan(0);
      low = next;
    }
  });

  // Both bounds come off rows stored minutes apart, so nothing guarantees the
  // low one is still below the high one. `generateNKeysBetween` throws outright
  // on that, which would fail the whole mutation rather than the placement.
  it('ranks after the low anchor when the two bounds tie', () => {
    const placed = between(item('a', k(2)), item('b', k(2)));

    expect(placed.sort_key > k(2)).toBe(true);
  });

  it('ranks after the low anchor when the bounds are the wrong way round', () => {
    const placed = between(item('a', k(5)), item('b', k(1)));

    expect(placed.sort_key > k(5)).toBe(true);
  });
});

describe('reorderRankUpdates', () => {
  it('re-ranks only the moved item', () => {
    const ordered = [item('a', k(0)), item('c', k(2)), item('b', k(1))];
    const updates = reorderRankUpdates(ordered, 'c');
    expect(updates.map((u) => u.id)).toEqual(['c']);
    const moved = item('c', updates[0]!.sort_key);
    expect(byRank(ordered[0]!, moved)).toBeLessThan(0);
    expect(byRank(moved, ordered[2]!)).toBeLessThan(0);
  });

  it('re-stamps the whole list when something has never been ranked', () => {
    const ordered = [item('a', k(0)), item('b', null), item('c', k(2))];
    expect(reorderRankUpdates(ordered, 'c').map((u) => u.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for an id that is not in the list', () => {
    expect(reorderRankUpdates([item('a', k(0))], 'missing')).toEqual([]);
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
    const items = rows(k(0), k(1), k(2));
    // Moving the last card into the middle.
    const display = [items[0]!, items[2]!, items[1]!];
    expect(neighborsAfterDrop(display, 't2')).toEqual({
      kind: 'between',
      afterId: 't0',
      beforeId: 't1',
    });
  });

  it('has no anchor above it at the top of the list', () => {
    const items = rows(k(0), k(1));
    expect(neighborsAfterDrop([items[1]!, items[0]!], 't1')).toEqual({
      kind: 'between',
      afterId: null,
      beforeId: 't0',
    });
  });

  it('has no anchor below it at the end of the list', () => {
    const items = rows(k(0), k(1));
    expect(neighborsAfterDrop(items, 't1')).toEqual({
      kind: 'between',
      afterId: 't0',
      beforeId: null,
    });
  });

  // Not an append: a drop whose card is not in the list it landed in describes
  // nothing, and the caller has to be able to tell that from the end of a column.
  it('declines to name neighbors for a card that is not in the list', () => {
    expect(neighborsAfterDrop(rows(k(0), k(1)), 'missing')).toBeNull();
  });

  // The property that makes a queued move survive: what gets sent now and what
  // gets replayed later describe the same drop. Asserted against two different
  // lists, because both halves computed from the drop-time list is the same
  // expression twice — `placementAfterDrop` is `placeBetweenNeighbors` of its own
  // `intent`, so comparing them can only ever agree.
  it('describes the same drop now and after the list has moved on', () => {
    const items = rows(k(0), k(1), k(2));
    // Moving the last card into the middle.
    const display = [items[0]!, items[2]!, items[1]!];
    const drop = placementAfterDrop(display, 't2')!;

    expect(drop.placement.sort_key > k(0) && drop.placement.sort_key < k(1)).toBe(true);

    // Minutes later: an unrelated card has gone and both anchors have been
    // re-ranked, so the key computed above now means somewhere else entirely.
    const later = ranked(item('t0', k(3)), item('t1', k(7)), item('t9', k(9)));
    const replayed = placeBetweenNeighbors(later, drop.intent);

    expect(replayed.exact).toBe(true);
    expect(replayed.placement.sort_key > k(3) && replayed.placement.sort_key < k(7)).toBe(true);
  });

  // The anchors are two rows the queue has no control over, so a teammate can
  // move one past the other before the drop is replayed.
  it('replays a drop whose anchors have swapped places without failing', () => {
    const later = ranked(item('a', k(5)), item('b', k(1)));
    const replayed = placeBetweenNeighbors(later, {
      kind: 'between',
      afterId: 'a',
      beforeId: 'b',
    });

    expect(replayed.exact).toBe(true);
    expect(replayed.placement.sort_key > k(5)).toBe(true);
  });
});

// The pairing for `placeAtIndex`, and the only thing a menu that names a slot
// has to queue: the same index, said in terms that survive the list changing.
describe('neighborsAtIndex', () => {
  const list = ranked(item('a', k(0)), item('b', k(1)), item('c', k(2)));

  it('has nothing either side of it in an empty list', () => {
    expect(neighborsAtIndex([], 0)).toEqual({ kind: 'append' });
  });

  it('names only the card below at the top', () => {
    expect(neighborsAtIndex(list, 0)).toEqual({ kind: 'between', afterId: null, beforeId: 'a' });
  });

  it('names the cards either side of an interior slot', () => {
    expect(neighborsAtIndex(list, 1)).toEqual({ kind: 'between', afterId: 'a', beforeId: 'b' });
  });

  it('names only the card above at the end', () => {
    expect(neighborsAtIndex(list, list.length)).toEqual({
      kind: 'between',
      afterId: 'c',
      beforeId: null,
    });
  });

  // Its one caller clamps to the length, so an index beyond that is nobody's
  // slot: it names no card on either side and means the end of the list.
  it('names nothing at all for an index past the end', () => {
    expect(neighborsAtIndex(list, 9)).toEqual({ kind: 'append' });
  });
});

describe('placeBetweenNeighbors', () => {
  it('lands between both anchors when both are still there', () => {
    const result = placeBetweenNeighbors(
      [
        { id: 'a', sort_key: k(0) },
        { id: 'b', sort_key: k(1) },
      ],
      { kind: 'between', afterId: 'a', beforeId: 'b' }
    );
    expect(result.exact).toBe(true);
    expect(result.placement.sort_key > k(0) && result.placement.sort_key < k(1)).toBe(true);
  });

  it('keeps the intent when only one anchor survived', () => {
    const result = placeBetweenNeighbors(
      [
        { id: 'a', sort_key: k(0) },
        { id: 'c', sort_key: k(5) },
      ],
      { kind: 'between', afterId: 'a', beforeId: 'gone' }
    );
    expect(result.exact).toBe(true);
    expect(result.placement.sort_key > k(0) && result.placement.sort_key < k(5)).toBe(true);
  });

  // Reported rather than silently landing somewhere arbitrary.
  it('is inexact when the cards it was dropped between are both gone', () => {
    const result = placeBetweenNeighbors([{ id: 'c', sort_key: k(5) }], {
      kind: 'between',
      afterId: 'gone',
      beforeId: 'also-gone',
    });
    expect(result.exact).toBe(false);
    expect(result.placement.sort_key > k(5)).toBe(true);
  });

  it('is exact when the end of the list is what was actually asked for', () => {
    const result = placeBetweenNeighbors([{ id: 'c', sort_key: k(5) }], { kind: 'append' });
    expect(result.exact).toBe(true);
  });
});

// The guard on the whole arrangement, and it defends itself: collapsing the two
// `between` arms of `Neighbors` back into one nullable arm makes this directive
// unused, which is itself an error, so the type cannot be quietly softened back
// into one that admits the value the split exists to forbid.
describe('the two between arms', () => {
  it('has no spelling for a move that landed nowhere', () => {
    // @ts-expect-error - the empty pair is `{ kind: 'append' }` or it is nothing
    placeBetweenNeighbors([], { kind: 'between', afterId: null, beforeId: null });
  });
});
