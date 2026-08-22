import { describe, expect, it, vi } from 'vitest';
import { patchById, removeById, upsertById } from './collections';

interface Row {
  id: string;
  name: string;
  rank?: string;
}

const rows: Row[] = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bea' },
];

describe('upsertById', () => {
  it('appends an entry the list does not hold', () => {
    expect(upsertById(rows, { id: 'c', name: 'Cy' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  // Position matters: a replaced card must not jump to the end of its column.
  it('replaces in place, keeping the entry’s position', () => {
    const next = upsertById(rows, { id: 'a', name: 'Ada Lovelace' });

    expect(next.map((r) => r.id)).toEqual(['a', 'b']);
    expect(next[0]?.name).toBe('Ada Lovelace');
  });

  it('sorts with the comparator when one is given, on both paths', () => {
    const byName = (x: Row, y: Row): number => x.name.localeCompare(y.name);

    expect(upsertById(rows, { id: 'c', name: 'Abe' }, byName).map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(upsertById(rows, { id: 'b', name: 'Abe' }, byName).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('leaves the input alone', () => {
    const input = [...rows];

    upsertById(input, { id: 'c', name: 'Cy' }, (x, y) => y.name.localeCompare(x.name));

    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('removeById', () => {
  it('drops the named entry and keeps the rest in order', () => {
    expect(removeById(rows, 'a').map((r) => r.id)).toEqual(['b']);
  });

  it('is a no-op for an id the list does not hold', () => {
    expect(removeById(rows, 'zz')).toEqual(rows);
  });

  it('leaves the input alone', () => {
    const input = [...rows];

    removeById(input, 'a');

    expect(input).toHaveLength(2);
  });
});

describe('patchById', () => {
  it('applies the patch to the match only', () => {
    const next = patchById(rows, 'b', (row) => ({ ...row, name: 'Bea Arthur' }));

    expect(next.map((r) => r.name)).toEqual(['Ada', 'Bea Arthur']);
  });

  it('does not call the patch for entries that do not match', () => {
    const patch = vi.fn((row: Row) => row);

    patchById(rows, 'b', patch);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]?.[0].id).toBe('b');
  });

  // Update-only is the whole point: an id the list has already dropped must not
  // come back, or a locally-deleted card is resurrected by its own in-flight edit.
  it('adds nothing for an id the list does not hold', () => {
    const next = patchById(rows, 'gone', (row) => ({ ...row, name: 'nope' }));

    expect(next.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('leaves the input alone', () => {
    const input = [{ id: 'a', name: 'Ada' }];

    patchById(input, 'a', (row) => ({ ...row, name: 'changed' }));

    expect(input[0]?.name).toBe('Ada');
  });
});
