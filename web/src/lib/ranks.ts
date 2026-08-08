import { generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

export interface Ranked {
  id: string;
  // Null on a project the caller has never reordered. Every other scope keys
  // every row, so only the project list ever sees this.
  sort_key: string | null;
}

export interface Placement {
  sort_key: string;
}

// A keyed row always sorts ahead of an unkeyed one rather than interleaving.
// Two unkeyed rows fall back to id, which is stable but arbitrary — it only
// happens on a project list the caller has never reordered.
export function byRank(a: Ranked, b: Ranked): number {
  if (a.sort_key === null && b.sort_key === null) return a.id.localeCompare(b.id);
  if (a.sort_key === null) return 1;
  if (b.sort_key === null) return -1;
  if (a.sort_key !== b.sort_key) return a.sort_key < b.sort_key ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function keys(a: string | null, b: string | null, count: number): string[] {
  return generateNKeysBetween(a, b, count, BASE_62_DIGITS);
}

function keyOf(item: Ranked | null | undefined): string | null {
  return item?.sort_key ?? null;
}

function extreme(items: readonly Ranked[], wantHighest: boolean): Ranked | null {
  return items.reduce<Ranked | null>((best, item) => {
    if (best === null) return item;
    const order = byRank(best, item);
    return (wantHighest ? order < 0 : order > 0) ? item : best;
  }, null);
}

export function appendRun(items: readonly Ranked[], count: number): Placement[] {
  return keys(keyOf(extreme(items, true)), null, count).map((sort_key) => ({ sort_key }));
}

export function append(items: readonly Ranked[]): Placement {
  return appendRun(items, 1)[0]!;
}

export function prepend(items: readonly Ranked[]): Placement {
  return { sort_key: keys(null, keyOf(extreme(items, false)), 1)[0]! };
}

export function between(previous: Ranked | null, next: Ranked | null): Placement {
  if (previous === null) return next === null ? append([]) : prepend([next]);
  if (next === null) return append([previous]);
  const low = keyOf(previous);
  const high = keyOf(next);
  // Asking for a key between equal bounds throws. Ranking straight after
  // `previous` keeps the drop where it was aimed instead of failing the whole
  // mutation.
  const collides = low !== null && high !== null && low >= high;
  return { sort_key: collides ? keys(low, null, 1)[0]! : keys(low, high, 1)[0]! };
}

// `sorted` must already be in rank order and must not contain the item being
// placed.
export function placeAtIndex(sorted: readonly Ranked[], index: number): Placement {
  if (sorted.length === 0) return append([]);
  if (index <= 0) return prepend(sorted);
  if (index >= sorted.length) return append(sorted);
  return between(sorted[index - 1]!, sorted[index]!);
}

/**
 * Where a drop landed, expressed as the cards it landed between rather than the
 * key that would put it there. A key is only meaningful against the list it was
 * computed from, so a move that has to wait — queued offline, replayed minutes
 * later — keeps its meaning in these terms and in no others.
 */
export interface Neighbors {
  afterId: string | null;
  beforeId: string | null;
}

// `items` is the display order *including* the moved card at its new index.
export function neighborsAfterDrop(items: readonly Ranked[], movedId: string): Neighbors {
  const index = items.findIndex((item) => item.id === movedId);
  const others = items.filter((item) => item.id !== movedId);
  if (index === -1) {
    return { afterId: null, beforeId: null };
  }
  if (index === 0) {
    return { afterId: null, beforeId: extreme(others, false)?.id ?? null };
  }
  // Anchors on the visual neighbour above the drop, then takes the lowest-ranked
  // sibling above it, so the placement stays right when the display is a
  // filtered partition rather than the whole column.
  const previous = items[index - 1]!;
  // Strictly greater by key, not by rank: a sibling that merely ties on key and
  // loses the id tiebreak is not something to squeeze in front of.
  const above = (candidate: Ranked): boolean =>
    previous.sort_key === null
      ? candidate.sort_key !== null
      : candidate.sort_key !== null && candidate.sort_key > previous.sort_key;
  let next: Ranked | null = null;
  for (const item of others) {
    if (above(item) && (next === null || byRank(item, next) < 0)) {
      next = item;
    }
  }
  return { afterId: previous.id, beforeId: next?.id ?? null };
}

// The pairing for `placeAtIndex`: the same slot, named by the cards on either
// side of it. `sorted` must be in rank order and must not contain the item
// being placed, exactly as `placeAtIndex` requires.
export function neighborsAtIndex(sorted: readonly Ranked[], index: number): Neighbors {
  return {
    afterId: index <= 0 ? null : (sorted[index - 1]?.id ?? null),
    beforeId: index >= sorted.length ? null : (sorted[index]?.id ?? null),
  };
}

/**
 * Turns neighbours back into a key against whatever the list looks like *now*.
 * `exact` is false when neither neighbour is still there — the card the user
 * aimed at has been deleted or moved away, so the result is the end of the list
 * and a guess. Callers surface that rather than pretending the drop landed.
 */
export function placeBetweenNeighbors(
  siblings: readonly Ranked[],
  { afterId, beforeId }: Neighbors
): { placement: Placement; exact: boolean } {
  const after = siblings.find((item) => item.id === afterId) ?? null;
  const before = siblings.find((item) => item.id === beforeId) ?? null;
  if (after !== null && before !== null) {
    return { placement: between(after, before), exact: true };
  }
  // One anchor still standing is enough: "immediately after this card" survives
  // whatever happened on the other side of the gap.
  if (after !== null) {
    return { placement: between(after, neighborBy(siblings, after, true)), exact: true };
  }
  if (before !== null) {
    return { placement: between(neighborBy(siblings, before, false), before), exact: true };
  }
  return {
    placement: append(siblings),
    // Asking for no anchors at all means the end of the list, which is exactly
    // where this lands — only a lost anchor is inexact.
    exact: afterId === null && beforeId === null,
  };
}

// The adjacent sibling on one side of `anchor` in rank order, or null at the end.
function neighborBy(
  siblings: readonly Ranked[],
  anchor: Ranked,
  wantAbove: boolean
): Ranked | null {
  let best: Ranked | null = null;
  for (const item of siblings) {
    if (item.id === anchor.id) continue;
    const order = byRank(item, anchor);
    if (wantAbove ? order <= 0 : order >= 0) continue;
    if (best === null || (wantAbove ? byRank(item, best) < 0 : byRank(item, best) > 0)) {
      best = item;
    }
  }
  return best;
}

export interface RankUpdate extends Placement {
  id: string;
}

// A one-shot reorder re-stamps the whole list, which is also what repairs an
// item that has never been ranked.
export function restack(orderedItems: readonly Ranked[]): RankUpdate[] {
  const fresh = keys(null, null, orderedItems.length);
  return orderedItems.map((item, index) => ({ id: item.id, sort_key: fresh[index]! }));
}

export function reorderRankUpdates(orderedItems: readonly Ranked[], movedId: string): RankUpdate[] {
  const index = orderedItems.findIndex((item) => item.id === movedId);
  if (index === -1) {
    return [];
  }
  if (orderedItems.some((item) => item.sort_key === null)) {
    return restack(orderedItems);
  }
  const others = orderedItems.filter((item) => item.id !== movedId);
  return [{ id: movedId, ...placeAtIndex(others, index) }];
}
