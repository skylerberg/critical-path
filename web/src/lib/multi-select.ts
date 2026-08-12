/** Whether a value applies to every item, some of them, or none. */
export type Held = 'all' | 'some' | 'none';

/**
 * An empty set holds nothing, which is what makes the checkbox render unticked
 * rather than mixed while the selection is being rebuilt.
 */
export function heldBy<T>(items: readonly T[], has: (item: T) => boolean): Held {
  const count = items.filter(has).length;
  if (count === 0) {
    return 'none';
  }
  return count === items.length ? 'all' : 'some';
}

/** Adds `value` when absent, removes it when present. Never mutates. */
export function toggleMembership(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((id) => id !== value) : [...list, value];
}
