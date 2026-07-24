import { describe, expect, it } from 'vitest';
import { append, between, positionForIndex, prepend, reorderPositionUpdates } from './positions';

describe('between', () => {
  it('returns the midpoint of two neighbors', () => {
    expect(between(1000, 2000)).toBe(1500);
    expect(between(-1000, 1000)).toBe(0);
  });
});

describe('append', () => {
  it('returns 1000 for an empty list', () => {
    expect(append([])).toBe(1000);
  });

  it('returns max + 1000', () => {
    expect(append([1000, 3000, 2000])).toBe(4000);
  });
});

describe('prepend', () => {
  it('returns 1000 for an empty list', () => {
    expect(prepend([])).toBe(1000);
  });

  it('returns min - 1000', () => {
    expect(prepend([1000, 3000, 2000])).toBe(0);
  });
});

describe('positionForIndex', () => {
  it('returns 1000 for an empty list', () => {
    expect(positionForIndex([], 0)).toBe(1000);
  });

  it('prepends at index 0', () => {
    expect(positionForIndex([1000, 2000], 0)).toBe(0);
  });

  it('appends past the end', () => {
    expect(positionForIndex([1000, 2000], 2)).toBe(3000);
  });

  it('takes the midpoint between neighbors', () => {
    expect(positionForIndex([1000, 2000, 4000], 1)).toBe(1500);
    expect(positionForIndex([1000, 2000, 4000], 2)).toBe(3000);
  });
});

describe('reorderPositionUpdates', () => {
  function item(id: string, position: number | null): { id: string; position: number | null } {
    return { id, position };
  }

  it('returns no updates when the moved id is not in the list', () => {
    expect(reorderPositionUpdates([item('a', 1000)], 'missing')).toEqual([]);
  });

  it('moves to the middle with a single midpoint update', () => {
    const updates = reorderPositionUpdates(
      [item('a', 1000), item('c', 3000), item('b', 2000)],
      'c'
    );
    expect(updates).toEqual([{ id: 'c', position: 1500 }]);
  });

  it('moves to the top with a prepend update', () => {
    const updates = reorderPositionUpdates(
      [item('c', 3000), item('a', 1000), item('b', 2000)],
      'c'
    );
    expect(updates).toEqual([{ id: 'c', position: 0 }]);
  });

  it('moves to the bottom with an append update', () => {
    const updates = reorderPositionUpdates(
      [item('b', 2000), item('c', 3000), item('a', 1000)],
      'a'
    );
    expect(updates).toEqual([{ id: 'a', position: 4000 }]);
  });

  it('handles a single-item list', () => {
    expect(reorderPositionUpdates([item('a', 500)], 'a')).toEqual([{ id: 'a', position: 1000 }]);
  });

  it('normalizes the whole list when a neighbor position is null', () => {
    const updates = reorderPositionUpdates(
      [item('a', 1000), item('c', 3000), item('b', null)],
      'c'
    );
    expect(updates).toEqual([
      { id: 'a', position: 1000 },
      { id: 'c', position: 2000 },
      { id: 'b', position: 3000 },
    ]);
  });

  it('normalizes the whole list when the moved item position is null', () => {
    const updates = reorderPositionUpdates(
      [item('c', null), item('a', 1000), item('b', 2000)],
      'c'
    );
    expect(updates).toEqual([
      { id: 'c', position: 1000 },
      { id: 'a', position: 2000 },
      { id: 'b', position: 3000 },
    ]);
  });

  it('normalizes the whole list when every position is null', () => {
    const updates = reorderPositionUpdates([item('b', null), item('a', null)], 'b');
    expect(updates).toEqual([
      { id: 'b', position: 1000 },
      { id: 'a', position: 2000 },
    ]);
  });
});
