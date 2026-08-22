/**
 * The three things every store here does to a list keyed by id.
 *
 * All three return a new array, because the stores replace values rather than
 * mutating them in place and `$state` is only notified by the assignment.
 */

/** Replaces the entry with this id, or appends it. `compare` re-sorts after. */
export function upsertById<T extends { id: string }>(
  items: readonly T[],
  item: T,
  compare?: (a: T, b: T) => number
): T[] {
  const next = items.some((existing) => existing.id === item.id)
    ? items.map((existing) => (existing.id === item.id ? item : existing))
    : [...items, item];
  return compare === undefined ? next : next.sort(compare);
}

export function removeById<T extends { id: string }>(items: readonly T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

/**
 * Update-only: an id the list does not hold is left alone rather than added.
 * Several realtime arms depend on that — re-adding a task the store has already
 * dropped resurrects a card the user deleted.
 */
export function patchById<T extends { id: string }>(
  items: readonly T[],
  id: string,
  patch: (item: T) => T
): T[] {
  return items.map((item) => (item.id === id ? patch(item) : item));
}
