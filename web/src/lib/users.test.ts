import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('loadWithRetry retries with backoff until a load succeeds, reporting one error', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      fetchMock.mockImplementation(async () => {
        calls += 1;
        return calls < 3
          ? jsonResponse(503, { error: 'down' })
          : jsonResponse(200, { users: [ada] });
      });
      const onFirstError = vi.fn();

      const cancel = users.loadWithRetry(onFirstError);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(onFirstError).toHaveBeenCalledTimes(1);
      expect(users.users).toEqual([]);

      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(onFirstError).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(users.users).toEqual([ada]);

      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('loadWithRetry stops retrying once cancelled', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(async () => jsonResponse(503, { error: 'down' }));

      const cancel = users.loadWithRetry(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      cancel();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
