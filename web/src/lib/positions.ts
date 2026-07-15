const GAP = 1000;

export function between(a: number, b: number): number {
  return (a + b) / 2;
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
  return between(sortedPositions[index - 1]!, sortedPositions[index]!);
}
