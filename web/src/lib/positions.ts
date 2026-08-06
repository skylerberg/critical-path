import { generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';

const GAP = 1000;

export interface Ranked {
  id: string;
  // Null on a project the caller has never reordered; the key is null there too.
  position: number | null;
  sort_key: string | null;
}

// The API still requires `position`, so a placement carries both. Ordering
// follows the key alone; the float rides along only until the release that
// drops it, and this half goes with it.
export interface Placement {
  position: number;
  sort_key: string;
}

// Falls back to `position` only when neither row is keyed, which is what a
// project the caller has never reordered looks like. A keyed row always sorts
// ahead of an unkeyed one rather than interleaving on a number they do not
// share a scale with.
export function byRank(a: Ranked, b: Ranked): number {
  if (a.sort_key === null && b.sort_key === null) {
    return (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id);
  }
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

function positions(items: readonly Ranked[]): number[] {
  return items.flatMap((item) => (item.position === null ? [] : [item.position]));
}

export function appendRun(items: readonly Ranked[], count: number): Placement[] {
  const known = positions(items);
  const base = known.length === 0 ? 0 : Math.max(...known);
  return keys(keyOf(extreme(items, true)), null, count).map((sort_key, index) => ({
    position: base + (index + 1) * GAP,
    sort_key,
  }));
}

export function append(items: readonly Ranked[]): Placement {
  return appendRun(items, 1)[0]!;
}

export function prepend(items: readonly Ranked[]): Placement {
  const known = positions(items);
  if (known.length === 0) return append([]);
  const base = Math.min(...known);
  return {
    position: base - GAP,
    sort_key: keys(null, keyOf(extreme(items, false)), 1)[0]!,
  };
}

export function between(previous: Ranked | null, next: Ranked | null): Placement {
  if (previous === null) return next === null ? append([]) : prepend([next]);
  if (next === null) return append([previous]);
  const low = keyOf(previous);
  const high = keyOf(next);
  // Two rows can still share a key until the unique index lands, and asking for
  // one between equal bounds throws. Ranking straight after `previous` keeps the
  // drop where it was aimed instead of failing the whole mutation.
  const collides = low !== null && high !== null && low >= high;
  return {
    position: ((previous.position ?? 0) + (next.position ?? 0)) / 2,
    sort_key: collides ? keys(low, null, 1)[0]! : keys(low, high, 1)[0]!,
  };
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
  return orderedItems.map((item, index) => ({
    id: item.id,
    position: (index + 1) * GAP,
    sort_key: fresh[index]!,
  }));
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
