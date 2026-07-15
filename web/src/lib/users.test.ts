import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { users } from './users.svelte';

const ada = { id: 'u-ada', email: 'ada@example.com', name: 'Ada' };
const brin = { id: 'u-brin', email: 'brin@example.com', name: 'Brin' };
const zed = { id: 'u-zed', email: 'zed@example.com', name: 'Zed' };

beforeEach(() => {
  fetchMock.mockReset();
  users.reset();
  fetchMock.mockImplementation(async () => jsonResponse(200, { users: [zed, ada, brin] }));
});

describe('users store', () => {
  it('loads and sorts users by name', async () => {
    await users.load();

    expect(new URL(requestAt(0).url).pathname).toBe('/api/users');
    expect(users.users).toEqual([ada, brin, zed]);
  });

  it('fetches only once across repeated and concurrent loads', async () => {
    await Promise.all([users.load(), users.load()]);
    await users.load();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('looks up users by id', async () => {
    await users.load();

    expect(users.byId('u-brin')).toEqual(brin);
    expect(users.byId('missing')).toBeUndefined();
  });

  it('refresh refetches even when already loaded', async () => {
    await users.load();
    fetchMock.mockResolvedValue(jsonResponse(200, { users: [ada] }));

    await users.refresh();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(users.users).toEqual([ada]);
  });

  it('reset clears the cache so load fetches again', async () => {
    await users.load();
    users.reset();
    expect(users.users).toEqual([]);

    await users.load();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('leaves the cache retryable after a failed load', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));

    await expect(users.load()).rejects.toThrow('network down');

    await users.load();
    expect(users.users).toEqual([ada, brin, zed]);
  });
});
