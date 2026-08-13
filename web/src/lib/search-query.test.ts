import { describe, expect, it } from 'vitest';
import {
  groupByProject,
  parseSearchQuery,
  searchPath,
  type SearchResult,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
} from './search-query';
import { testUuid } from './test-ids';

const GAME = testUuid('p1');
const SITE = testUuid('p2');

function result(projectId: string, projectName: string, title: string): SearchResult {
  return {
    task_id: testUuid(title),
    title,
    column_name: 'Todo',
    project_id: projectId,
    project_name: projectName,
  };
}

describe('parseSearchQuery', () => {
  it('reads an absent or empty q as no query', () => {
    expect(parseSearchQuery('')).toBe('');
    expect(parseSearchQuery('?')).toBe('');
    expect(parseSearchQuery('?other=1')).toBe('');
    expect(parseSearchQuery('?q=')).toBe('');
  });

  it('accepts a search with or without the leading question mark', () => {
    expect(parseSearchQuery('?q=boss')).toBe('boss');
    expect(parseSearchQuery('q=boss')).toBe('boss');
  });

  it('decodes and trims', () => {
    expect(parseSearchQuery('?q=boss%20fight')).toBe('boss fight');
    expect(parseSearchQuery('?q=%20%20boss%20%20')).toBe('boss');
    expect(parseSearchQuery('?q=%20%20')).toBe('');
  });

  it('takes the first q when the search repeats it', () => {
    expect(parseSearchQuery('?q=first&q=second')).toBe('first');
  });
});

describe('searchPath', () => {
  it('drops the query entirely when there is nothing to search for', () => {
    expect(searchPath('')).toBe('/search');
    expect(searchPath('   ')).toBe('/search');
  });

  it('trims before deciding and before encoding', () => {
    expect(searchPath('  boss  ')).toBe('/search?q=boss');
  });

  it('percent-encodes characters that would otherwise break the query structure', () => {
    expect(searchPath('a&b=c#d')).toBe('/search?q=a%26b%3Dc%23d');
    expect(searchPath('boss fight')).toBe('/search?q=boss%20fight');
  });

  it('round-trips through parseSearchQuery', () => {
    for (const query of ['boss fight', 'a&b=c#d', 'ü', '100%']) {
      expect(parseSearchQuery(searchPath(query).replace('/search', ''))).toBe(query);
    }
  });
});

// The bounds mirror the server's; outside them the request is a guaranteed 400.
describe('query length bounds', () => {
  it('are the server’s, not a guess', () => {
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(1);
    expect(SEARCH_MAX_QUERY_LENGTH).toBe(200);
  });
});

describe('groupByProject', () => {
  it('is nothing at all for no results', () => {
    expect(groupByProject([])).toEqual([]);
  });

  it('collects a project’s results into one group, in server order', () => {
    const groups = groupByProject([
      result(GAME, 'Game', 'Fix login'),
      result(GAME, 'Game', 'Fix logout'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.projectId).toBe(GAME);
    expect(groups[0]?.projectName).toBe('Game');
    expect(groups[0]?.results.map((r) => r.title)).toEqual(['Fix login', 'Fix logout']);
  });

  // Groups follow first appearance, so they inherit the server's global ranking:
  // the project holding the best hit leads.
  it('orders groups by first appearance, not by size', () => {
    const groups = groupByProject([
      result(SITE, 'Site', 'best hit'),
      result(GAME, 'Game', 'second'),
      result(GAME, 'Game', 'third'),
      result(GAME, 'Game', 'fourth'),
    ]);

    expect(groups.map((g) => g.projectId)).toEqual([SITE, GAME]);
    expect(groups[1]?.results).toHaveLength(3);
  });

  it('regroups a project whose results are interleaved with another’s', () => {
    const groups = groupByProject([
      result(GAME, 'Game', 'one'),
      result(SITE, 'Site', 'two'),
      result(GAME, 'Game', 'three'),
    ]);

    expect(groups.map((g) => g.projectId)).toEqual([GAME, SITE]);
    expect(groups[0]?.results.map((r) => r.title)).toEqual(['one', 'three']);
    expect(groups[1]?.results.map((r) => r.title)).toEqual(['two']);
  });

  it('does not mutate the results it was given', () => {
    const results = [result(GAME, 'Game', 'one')];
    const copy = [...results];

    groupByProject(results);

    expect(results).toEqual(copy);
  });
});
