import { describe, expect, it } from 'vitest';
import { heldBy, toggleMembership } from './multi-select';

describe('heldBy', () => {
  const items = [{ tags: ['a'] }, { tags: ['a', 'b'] }, { tags: [] }];

  it('reports none, some and all', () => {
    expect(heldBy(items, (item) => item.tags.includes('z'))).toBe('none');
    expect(heldBy(items, (item) => item.tags.includes('b'))).toBe('some');
    expect(heldBy(items, (item) => item.tags.length >= 0)).toBe('all');
  });

  it('calls an empty set none rather than all', () => {
    expect(heldBy([], () => true)).toBe('none');
  });

  it('calls a single matching item all', () => {
    expect(heldBy([{ tags: ['a'] }], (item) => item.tags.includes('a'))).toBe('all');
  });
});

describe('toggleMembership', () => {
  it('adds a value it does not hold and removes one it does', () => {
    expect(toggleMembership(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleMembership(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('leaves the input alone', () => {
    const original = ['a'];

    toggleMembership(original, 'b');

    expect(original).toEqual(['a']);
  });
});
