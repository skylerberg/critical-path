import { generateNKeysBetween, BASE_62_DIGITS } from 'fractional-indexing';
import { CliError, EXIT } from './api/errors';

export interface Ranked {
  id: string;
  sort_key: string;
}

export function byRank(a: Ranked, b: Ranked): number {
  return a.sort_key < b.sort_key ? -1 : a.sort_key > b.sort_key ? 1 : a.id.localeCompare(b.id);
}

function keys(a: string | null, b: string | null, count: number): string[] {
  return generateNKeysBetween(a, b, count, BASE_62_DIGITS);
}

// A run between two neighbours never runs out: the keys grow a character rather
// than exhausting a gap, which is what the float scheme did after a few dozen.
export function spreadBetween(a: string | null, b: string | null, count: number): string[] {
  return keys(a, b, count);
}

export function keysForIndex(sorted: readonly Ranked[], index: number, count: number): string[] {
  if (sorted.length === 0 || index >= sorted.length) {
    return keys(sorted.length === 0 ? null : sorted[sorted.length - 1]!.sort_key, null, count);
  }
  if (index <= 0) {
    return keys(null, sorted[0]!.sort_key, count);
  }
  return keys(sorted[index - 1]!.sort_key, sorted[index]!.sort_key, count);
}

export interface Placement {
  top?: boolean;
  bottom?: boolean;
  before?: string;
  after?: string;
}

export function placementIndex(
  placement: Placement,
  sortedIds: readonly string[],
  resolveAnchor: (ref: string) => string
): number {
  const chosen = [placement.top, placement.bottom, placement.before, placement.after].filter(
    (p) => p != null && p !== false
  );
  if (chosen.length > 1) {
    throw new CliError('Pass at most one of --top, --bottom, --before, --after', EXIT.usage);
  }
  if (placement.top) return 0;
  if (placement.before != null) {
    return sortedIds.indexOf(resolveAnchor(placement.before));
  }
  if (placement.after != null) {
    return sortedIds.indexOf(resolveAnchor(placement.after)) + 1;
  }
  return sortedIds.length;
}

export function keysForPlacement(
  placement: Placement,
  sorted: readonly Ranked[],
  resolveAnchor: (ref: string) => string,
  count: number
): string[] {
  const index = placementIndex(
    placement,
    sorted.map((item) => item.id),
    resolveAnchor
  );
  return keysForIndex(sorted, index, count);
}

export function keyForPlacement(
  placement: Placement,
  sorted: readonly Ranked[],
  resolveAnchor: (ref: string) => string
): string {
  return keysForPlacement(placement, sorted, resolveAnchor, 1)[0]!;
}
