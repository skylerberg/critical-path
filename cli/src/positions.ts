import { CliError, EXIT } from './api/errors';

const GAP = 1000;

export function between(a: number, b: number): number {
  const mid = (a + b) / 2;
  if (!(mid > a && mid < b)) {
    throw new CliError(
      'No room between the neighboring positions; use --top or --bottom instead',
      EXIT.failure
    );
  }
  return mid;
}

export function append(positions: readonly number[]): number {
  if (positions.length === 0) return GAP;
  return Math.max(...positions) + GAP;
}

export function prepend(positions: readonly number[]): number {
  if (positions.length === 0) return GAP;
  return Math.min(...positions) - GAP;
}

export function positionForIndex(sortedPositions: readonly number[], index: number): number {
  if (sortedPositions.length === 0) return GAP;
  if (index <= 0) return prepend(sortedPositions);
  if (index >= sortedPositions.length) return append(sortedPositions);
  return between(sortedPositions[index - 1], sortedPositions[index]);
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

export function positionForPlacement(
  placement: Placement,
  sorted: readonly { id: string; position: number }[],
  resolveAnchor: (ref: string) => string
): number {
  const index = placementIndex(
    placement,
    sorted.map((item) => item.id),
    resolveAnchor
  );
  return positionForIndex(
    sorted.map((item) => item.position),
    index
  );
}
