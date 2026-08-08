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
