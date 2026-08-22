import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  UserSearchStore,
  USER_SEARCH_MAX_QUERY_LENGTH,
  USER_SEARCH_MIN_QUERY_LENGTH,
} from './userSearch.svelte';
import type { User } from './users.svelte';

const sky: User = { id: 'u-sky', name: 'Skyler Berg', avatar_url: null };
const ada: User = { id: 'u-ada', name: 'Ada Lovelace', avatar_url: null };

function respondWith(users: User[], truncated = false): void {
  fetchMock.mockImplementation(async () => jsonResponse(200, { users, truncated }));
}

function gate(): { open: () => void; wait: Promise<void> } {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { open, wait };
}

let store: UserSearchStore;

beforeEach(() => {
  fetchMock.mockReset();
  store = new UserSearchStore();
});

describe('UserSearchStore', () => {
  it('sends the trimmed query and keeps what came back', async () => {
    respondWith([sky], true);

    await store.run('  sky  ');

    expect(new URL(requestAt(0).url).pathname).toBe('/api/users/search');
    expect(new URL(requestAt(0).url).searchParams.get('q')).toBe('sky');
    expect(store.results).toEqual([sky]);
    expect(store.truncated).toBe(true);
    expect(store.status).toBe('loaded');
  });

  it.each([
    ['under the minimum', 'a'.repeat(USER_SEARCH_MIN_QUERY_LENGTH - 1)],
    ['over the maximum', 'a'.repeat(USER_SEARCH_MAX_QUERY_LENGTH + 1)],
    ['empty', '   '],
  ])('asks nothing for a query that is %s', async (_label, query) => {
    respondWith([sky]);

    await store.run(query);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.results).toEqual([]);
    expect(store.status).toBe('idle');
  });

  it('leaves the rows in place while the next query is in flight', async () => {
    respondWith([sky]);
    await store.run('sky');

    const slow = gate();
    fetchMock.mockImplementation(async () => {
      await slow.wait;
      return jsonResponse(200, { users: [ada], truncated: false });
    });
    const pending = store.run('ada');

    expect(store.status).toBe('loading');
    expect(store.results).toEqual([sky]);

    slow.open();
    await pending;
    expect(store.results).toEqual([ada]);
  });

  it('ignores a slow response overtaken by a newer one', async () => {
    const slow = gate();
    fetchMock.mockImplementationOnce(async () => {
      await slow.wait;
      return jsonResponse(200, { users: [ada], truncated: false });
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [sky], truncated: false }));

    const first = store.run('ada');
    const second = store.run('sky');
    await second;
    slow.open();
    await first;

    expect(store.results).toEqual([sky]);
  });

  // The rows would otherwise answer an older query, and adding one of them
  // grants board access to whoever it now names.
  it('drops the rows when the search fails', async () => {
    respondWith([sky]);
    await store.run('sky');

    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }));
    await store.run('ada');

    expect(store.results).toEqual([]);
    expect(store.status).toBe('error');
    expect(store.error).toBe('boom');
  });

  // Same race as the successful one above, on the arm that also empties the list:
  // an overtaken failure would leave the picker showing an error for a query the
  // typist has already moved past.
  it('ignores a failure overtaken by a newer query', async () => {
    const slow = gate();
    fetchMock.mockImplementationOnce(async () => {
      await slow.wait;
      return jsonResponse(500, { error: 'boom' });
    });
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [sky], truncated: false }));

    const first = store.run('ada');
    const second = store.run('sky');
    await second;
    slow.open();
    await first;

    expect(store.results).toEqual([sky]);
    expect(store.status).toBe('loaded');
    expect(store.error).toBeNull();
  });

  it('reports a failure that never reached the server', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });

    await store.run('sky');

    expect(store.status).toBe('error');
    expect(store.error).toBe('Search failed');
  });

  it('writes nothing once it has been reset', async () => {
    const slow = gate();
    fetchMock.mockImplementation(async () => {
      await slow.wait;
      return jsonResponse(200, { users: [sky], truncated: false });
    });

    const pending = store.run('sky');
    store.reset();
    slow.open();
    await pending;

    expect(store.results).toEqual([]);
    expect(store.status).toBe('idle');
  });
});
