import { describe, expect, it } from 'vitest';
import { filtersToSearch, mergeFilterSearch, noFilters, parseFilters } from './board-filters';

describe('parseFilters', () => {
  it('reads an empty search as no filters', () => {
    expect(parseFilters('')).toEqual(noFilters());
    expect(parseFilters('?')).toEqual(noFilters());
  });

  it('reads all three dimensions', () => {
    expect(parseFilters('?labels=l1,l2&assignees=u1&q=boss%20fight')).toEqual({
      labelIds: ['l1', 'l2'],
      assigneeIds: ['u1'],
      query: 'boss fight',
    });
  });

  it('accepts a search without the leading question mark and ignores unknown params', () => {
    expect(parseFilters('labels=l1')).toEqual({ labelIds: ['l1'], assigneeIds: [], query: '' });
    expect(parseFilters('?foo=1&q=x')).toEqual({ labelIds: [], assigneeIds: [], query: 'x' });
  });

  it('drops empty segments and de-duplicates ids', () => {
    expect(parseFilters('?labels=,,l1,l1').labelIds).toEqual(['l1']);
  });

  it('merges repeated params in first-seen order', () => {
    expect(parseFilters('?labels=l1&labels=l2').labelIds).toEqual(['l1', 'l2']);
  });

  it('trims the query', () => {
    expect(parseFilters('?q=%20%20').query).toBe('');
    expect(parseFilters('?q=%20boss%20').query).toBe('boss');
  });
});

describe('filtersToSearch', () => {
  it('serializes no filters to an empty string', () => {
    expect(filtersToSearch(noFilters())).toBe('');
  });

  it('treats a blank query as no filter', () => {
    expect(filtersToSearch({ labelIds: [], assigneeIds: [], query: '   ' })).toBe('');
  });

  it('emits labels, assignees, then q regardless of how the state was built', () => {
    expect(filtersToSearch({ labelIds: [], assigneeIds: [], query: 'x' })).toBe('?q=x');
    expect(filtersToSearch({ labelIds: ['l1'], assigneeIds: ['u1'], query: 'x' })).toBe(
      '?labels=l1&assignees=u1&q=x'
    );
  });

  it('percent-encodes characters that would otherwise break the query structure', () => {
    expect(filtersToSearch({ labelIds: [], assigneeIds: [], query: 'a&b=c#d' })).toBe(
      '?q=a%26b%3Dc%23d'
    );
    expect(filtersToSearch({ labelIds: [], assigneeIds: [], query: 'boss fight' })).toBe(
      '?q=boss%20fight'
    );
  });

  it('round-trips through parseFilters', () => {
    const filters = {
      labelIds: ['3f6f12e8-1111-4444-8888-000000000001', 'b0e6ee73-2222-4444-8888-000000000002'],
      assigneeIds: ['fce2bfc2-3333-4444-8888-000000000003'],
      query: 'boss fight',
    };
    expect(parseFilters(filtersToSearch(filters))).toEqual(filters);
  });
});

describe('mergeFilterSearch', () => {
  const filters = { labelIds: ['l1'], assigneeIds: [], query: '' };

  it('matches filtersToSearch when there is nothing else in the search', () => {
    expect(mergeFilterSearch('', filters)).toBe('?labels=l1');
    expect(mergeFilterSearch('?labels=l-old&q=gone', filters)).toBe('?labels=l1');
    expect(mergeFilterSearch('?q=gone', noFilters())).toBe('');
  });

  it('keeps the keys the filters do not own, on both sides of a filter change', () => {
    expect(mergeFilterSearch('?from=my-tasks', filters)).toBe('?labels=l1&from=my-tasks');
    expect(mergeFilterSearch('?from=my-tasks&q=gone', noFilters())).toBe('?from=my-tasks');
    expect(mergeFilterSearch('?a=1&q=gone&b=2', noFilters())).toBe('?a=1&b=2');
  });

  // The store redirects whenever its output differs from the current search, so an
  // already-canonical search must come back byte-identical or it would loop.
  it('is idempotent', () => {
    const once = mergeFilterSearch('?from=my-tasks&labels=l1', filters);
    expect(mergeFilterSearch(once, filters)).toBe(once);
  });
});
