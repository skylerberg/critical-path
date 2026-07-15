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

describe('users loadForProject', () => {
  it('fetches the project-scoped list, caches per project, and exposes it', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [brin, ada] }));

    await users.loadForProject('p-1');
    await users.loadForProject('p-1');

    const request = requestAt(0);
    const url = new URL(request.url);
    expect(url.pathname).toBe('/api/users');
    expect(url.searchParams.get('project_id')).toBe('p-1');
    expect(users.forProject('p-1').map((u) => u.name)).toEqual(['Ada', 'Brin']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves byId from the project cache even without a global load', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [zed] }));

    await users.loadForProject('p-9');

    expect(users.byId('u-zed')).toEqual(zed);
  });

  it('stays retryable after a failed project load', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse(503, { error: 'down' }));
    await users.loadForProject('p-2');
    expect(users.forProject('p-2')).toEqual([]);

    fetchMock.mockImplementation(async () => jsonResponse(200, { users: [ada] }));
    await users.loadForProject('p-2');

    expect(users.forProject('p-2')).toEqual([ada]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll drops the project cache so the next load refetches', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { users: [ada] }));
    await users.loadForProject('p-3');
    expect(users.forProject('p-3')).toEqual([ada]);

    users.invalidateAll();
    expect(users.forProject('p-3')).toEqual([]);

    fetchMock.mockImplementationOnce(async () => jsonResponse(200, { users: [ada, brin] }));
    await users.loadForProject('p-3');

    expect(users.forProject('p-3').map((u) => u.id)).toEqual(['u-ada', 'u-brin']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('users displayFor', () => {
  it('returns a neutral placeholder for an unknown id', () => {
    const placeholder = users.displayFor('ghost');
    expect(placeholder).toEqual({ id: 'ghost', name: '', email: '' });
  });

  it('returns the real user when known', async () => {
    await users.load();
    expect(users.displayFor('u-ada')).toEqual(ada);
  });
});

describe('users upsert', () => {
  it('adds a new user in sorted order and replaces an existing one', async () => {
    await users.load();
    users.upsert({ id: 'u-mel', email: 'mel@example.com', name: 'Mel' });
    expect(users.users.map((u) => u.name)).toEqual(['Ada', 'Brin', 'Mel', 'Zed']);

    users.upsert({ id: 'u-ada', email: 'ada@new.com', name: 'Ada' });
    expect(users.byId('u-ada')?.email).toBe('ada@new.com');
  });
});
