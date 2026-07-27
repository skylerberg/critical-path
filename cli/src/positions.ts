import { CliError, EXIT } from './api/errors';

const GAP = 1000;

const PLACEMENT_FLAG_REMEDY = 'use --top or --bottom instead';

// Spread as one block rather than repeatedly bisecting: bisecting per item
// halves the remaining gap each time and runs out of float precision after a
// few dozen items.
export function spreadBetween(
  a: number,
  b: number,
  count: number,
  remedy: string = PLACEMENT_FLAG_REMEDY
): number[] {
  const step = (b - a) / (count + 1);
  const positions = Array.from({ length: count }, (_, i) => a + step * (i + 1));
  let previous = a;
  for (const position of positions) {
    if (!(position > previous && position < b)) {
      throw new CliError(`No room between the neighboring positions; ${remedy}`, EXIT.failure);
    }
    previous = position;
  }
  return positions;
}

export function append(positions: readonly number[]): number {
  if (positions.length === 0) return GAP;
  return Math.max(...positions) + GAP;
}

export function prepend(positions: readonly number[]): number {
  if (positions.length === 0) return GAP;
  return Math.min(...positions) - GAP;
}

export function positionsForIndex(
  sortedPositions: readonly number[],
  index: number,
  count: number,
  remedy?: string
): number[] {
  if (sortedPositions.length === 0 || index >= sortedPositions.length) {
    const first = append(sortedPositions);
    return Array.from({ length: count }, (_, i) => first + i * GAP);
  }
  if (index <= 0) {
    const last = prepend(sortedPositions);
    return Array.from({ length: count }, (_, i) => last - (count - 1 - i) * GAP);
  }
  return spreadBetween(sortedPositions[index - 1], sortedPositions[index], count, remedy);
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

export function positionsForPlacement(
  placement: Placement,
  sorted: readonly { id: string; position: number }[],
  resolveAnchor: (ref: string) => string,
  count: number
): number[] {
  const index = placementIndex(
    placement,
    sorted.map((item) => item.id),
    resolveAnchor
  );
  return positionsForIndex(
    sorted.map((item) => item.position),
    index,
    count
  );
}

export function positionForPlacement(
  placement: Placement,
  sorted: readonly { id: string; position: number }[],
  resolveAnchor: (ref: string) => string
): number {
  return positionsForPlacement(placement, sorted, resolveAnchor, 1)[0];
}
