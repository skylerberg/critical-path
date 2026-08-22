import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  groupByProject,
  parseSearchQuery,
  searchPath,
  SEARCH_MAX_QUERY_LENGTH,
  type SearchResult,
} from './search-query';
import { search } from './search.svelte';

function result(taskId: string, projectId: string, projectName: string): SearchResult {
  return {
    task_id: taskId,
    title: `Task ${taskId}`,
    project_id: projectId,
    project_name: projectName,
    column_name: 'To Do',
  };
}

function respondWith(results: SearchResult[], truncated = false): void {
  fetchMock.mockImplementation(async () => jsonResponse(200, { results, truncated }));
}

function gate(): { open: () => void; wait: Promise<void> } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { open, wait };
}

beforeEach(() => {
  fetchMock.mockReset();
  search.reset();
});

describe('search-query helpers', () => {
  it('reads and trims q out of a query string', () => {
    expect(parseSearchQuery('?q=%20ship%20it%20')).toBe('ship it');
    expect(parseSearchQuery('?labels=a')).toBe('');
    expect(parseSearchQuery('')).toBe('');
  });

  it('builds an encodable path and drops an empty query', () => {
    expect(searchPath('ship it')).toBe('/search?q=ship%20it');
    expect(searchPath('  ')).toBe('/search');
  });

  it('groups by project in first-appearance order and keeps server order inside a group', () => {
    const groups = groupByProject([
      result('t-1', 'p-1', 'Alpha'),
      result('t-2', 'p-2', 'Beta'),
      result('t-3', 'p-1', 'Alpha'),
    ]);

    expect(groups.map((group) => group.projectId)).toEqual(['p-1', 'p-2']);
    expect(groups[0]!.projectName).toBe('Alpha');
    expect(groups[0]!.results.map((row) => row.task_id)).toEqual(['t-1', 't-3']);
    expect(groups[1]!.results.map((row) => row.task_id)).toEqual(['t-2']);
  });
});

describe('search store', () => {
  it('sends the trimmed query and stores the results', async () => {
    respondWith([result('t-1', 'p-1', 'Alpha')], true);

    await search.run('  ship  ');

    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('ship');
    expect(search.query).toBe('ship');
    expect(search.status).toBe('loaded');
    expect(search.truncated).toBe(true);
    expect(search.results.map((row) => row.task_id)).toEqual(['t-1']);
    expect(search.groups.map((group) => group.projectId)).toEqual(['p-1']);
  });

  it('does not call the API for a query that is empty once trimmed', async () => {
    await search.run('   ');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(search.status).toBe('idle');
    expect(search.results).toEqual([]);
  });

  it('calls the API for a single character', async () => {
    await search.run('a');

    expect(fetchMock).toHaveBeenCalled();
    expect(search.query).toBe('a');
  });

  it('does not call the API for a query past the maximum length', async () => {
    await search.run('x'.repeat(SEARCH_MAX_QUERY_LENGTH + 1));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(search.status).toBe('idle');
    expect(search.results).toEqual([]);
  });

  it('clears previous results once the query falls below the minimum', async () => {
    respondWith([result('t-1', 'p-1', 'Alpha')]);
    await search.run('ship');

    await search.run('');

    expect(search.query).toBe('');
    expect(search.results).toEqual([]);
    expect(search.truncated).toBe(false);
    expect(search.status).toBe('idle');
  });

  it('keeps the previous results on screen while the next query loads', async () => {
    respondWith([result('t-1', 'p-1', 'Alpha')]);
    await search.run('ship');

    const next = gate();
    fetchMock.mockImplementation(async () => {
      await next.wait;
      return jsonResponse(200, { results: [result('t-2', 'p-1', 'Alpha')], truncated: false });
    });
    const pending = search.run('ship it');

    expect(search.status).toBe('loading');
    expect(search.results.map((row) => row.task_id)).toEqual(['t-1']);

    next.open();
    await pending;
    expect(search.results.map((row) => row.task_id)).toEqual(['t-2']);
  });

  it('discards a slow response that lost the race', async () => {
    const stale = gate();
    fetchMock.mockImplementationOnce(async () => {
      await stale.wait;
      return jsonResponse(200, { results: [result('stale', 'p-9', 'Stale')], truncated: true });
    });
    const slow = search.run('shi');

    respondWith([result('fresh', 'p-1', 'Alpha')]);
    await search.run('ship');

    stale.open();
    await slow;

    expect(search.query).toBe('ship');
    expect(search.truncated).toBe(false);
    expect(search.results.map((row) => row.task_id)).toEqual(['fresh']);
    expect(search.status).toBe('loaded');
  });

  // The failure path clears the rows, so an overtaken one landing late empties a
  // list the user is already reading and blames it on a query they have left.
  it('discards a failure that lost the race with a newer query', async () => {
    const stale = gate();
    fetchMock.mockImplementationOnce(async () => {
      await stale.wait;
      return jsonResponse(500, { error: 'Boom' });
    });
    const slow = search.run('shi');

    respondWith([result('fresh', 'p-1', 'Alpha')]);
    await search.run('ship');

    stale.open();
    await slow;

    expect(search.status).toBe('loaded');
    expect(search.error).toBeNull();
    expect(search.results.map((row) => row.task_id)).toEqual(['fresh']);
  });

  it('reports the server error message and drops the older query rows', async () => {
    respondWith([result('t-1', 'p-1', 'Alpha')], true);
    await search.run('ship');

    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Boom' }));
    await search.run('ship it');

    expect(search.status).toBe('error');
    expect(search.error).toBe('Boom');
    expect(search.results).toEqual([]);
    expect(search.truncated).toBe(false);
  });

  it('reports a network rejection instead of hanging on loading', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });

    await search.run('ship');

    expect(search.status).toBe('error');
    expect(search.error).toBe('Search failed');
  });

  it('reset clears state and makes an in-flight response a no-op', async () => {
    const inFlight = gate();
    fetchMock.mockImplementation(async () => {
      await inFlight.wait;
      return jsonResponse(200, { results: [result('t-1', 'p-1', 'Alpha')], truncated: true });
    });
    const pending = search.run('ship');

    search.reset();
    inFlight.open();
    await pending;

    expect(search.query).toBe('');
    expect(search.results).toEqual([]);
    expect(search.truncated).toBe(false);
    expect(search.status).toBe('idle');
  });
});
