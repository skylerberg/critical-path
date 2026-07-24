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

export interface PositionUpdate {
  id: string;
  position: number;
}

// A null position (an item never reordered) leaves no numeric gap to midpoint
// into, so any null forces a one-time normalization of the whole list;
// otherwise only the moved item needs a new position.
export function reorderPositionUpdates(
  orderedItems: readonly { id: string; position: number | null }[],
  movedId: string
): PositionUpdate[] {
  const index = orderedItems.findIndex((item) => item.id === movedId);
  if (index === -1) {
    return [];
  }
  if (orderedItems.some((item) => item.position === null)) {
    return orderedItems.map((item, i) => ({ id: item.id, position: (i + 1) * GAP }));
  }
  const others = orderedItems.filter((item) => item.id !== movedId).map((item) => item.position!);
  return [{ id: movedId, position: positionForIndex(others, index) }];
}
