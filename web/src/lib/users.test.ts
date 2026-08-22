import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineCache, readUsersSnapshot, saveUsersSnapshot } from './offline-cache';
import { session } from './session.svelte';
import { testUuid } from './test-ids';
import { users, type User } from './users.svelte';

const ada = { id: 'u-ada', name: 'Ada' };
const brin = { id: 'u-brin', name: 'Brin' };
const zed = { id: 'u-zed', name: 'Zed' };

const ACCOUNT_ID = testUuid('ada');
const me = {
  id: ACCOUNT_ID,
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: true,
};
const cached: User[] = [
  { id: 'u-ada', name: 'Ada', avatar_url: null },
  { id: 'u-brin', name: 'Brin', avatar_url: null },
];

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

  it('loadWithRetry stops retrying once canceled', async () => {
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
    expect(placeholder).toEqual({ id: 'ghost', name: '', avatar_url: null });
  });

  it('returns the real user when known', async () => {
    await users.load();
    expect(users.displayFor('u-ada')).toEqual(ada);
  });
});

describe('users upsert', () => {
  it('adds a new user in sorted order and replaces an existing one', async () => {
    await users.load();
    users.upsert({ id: 'u-mel', name: 'Mel', avatar_url: null });
    expect(users.users.map((u) => u.name)).toEqual(['Ada', 'Brin', 'Mel', 'Zed']);

    users.upsert({ id: 'u-ada', name: 'Ada Renamed', avatar_url: null });
    expect(users.byId('u-ada')?.name).toBe('Ada Renamed');
  });
});

describe('users applyRealtime', () => {
  it('updates the global list and any project caches holding the user', async () => {
    await users.load();
    await users.loadForProject('p-1');

    const updated = users.applyRealtime({
      id: 'u-ada',
      name: 'Ada Prime',
      avatar_url: '/api/avatars/abc',
    });

    expect(updated?.name).toBe('Ada Prime');
    expect(users.byId('u-ada')).toEqual({
      id: 'u-ada',
      name: 'Ada Prime',
      avatar_url: '/api/avatars/abc',
    });
    expect(users.forProject('p-1').find((u) => u.id === 'u-ada')?.name).toBe('Ada Prime');
    expect(users.users.map((u) => u.name)).toEqual([...users.users.map((u) => u.name)].sort());
  });

  it('adds a previously unknown user', () => {
    const updated = users.applyRealtime({
      id: 'u-new',
      name: 'New',
      avatar_url: null,
    });
    expect(updated).not.toBeNull();
    expect(users.byId('u-new')?.name).toBe('New');
  });

  it('keeps an address out of the store even when one arrives on the wire', () => {
    const updated = users.applyRealtime({
      id: 'u-leak',
      name: 'Leaky',
      email: 'leaky@example.com',
      avatar_url: null,
    });

    expect(updated).toEqual({ id: 'u-leak', name: 'Leaky', avatar_url: null });
    expect(JSON.stringify(users.byId('u-leak'))).not.toContain('leaky@example.com');
  });

  it('ignores malformed payloads', () => {
    expect(users.applyRealtime(null)).toBeNull();
    expect(users.applyRealtime({ id: 42 })).toBeNull();
    expect(users.users).toEqual([]);
  });
});

// Every case above runs signed out, where the snapshot arm short-circuits on the
// missing account id and the store always rethrows — so the whole fallback, and
// the write that feeds it, only exist once someone is signed in.
describe('users offline snapshot', () => {
  beforeEach(async () => {
    session.user = me;
    await clearOfflineCache(ACCOUNT_ID);
  });

  afterEach(() => {
    session.user = null;
  });

  it('shows the last visit’s names rather than blank placeholders when the network is gone', async () => {
    await saveUsersSnapshot(ACCOUNT_ID, cached);
    fetchMock.mockRejectedValue(new TypeError('network down'));

    await expect(users.load()).resolves.toBeUndefined();

    expect(users.users).toEqual(cached);
  });

  it('still rejects a read the server refused, and shows nobody', async () => {
    await saveUsersSnapshot(ACCOUNT_ID, cached);
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Forbidden' }));

    await expect(users.load()).rejects.toThrow('Forbidden');

    expect(users.users).toEqual([]);
  });

  it('rejects when there is nothing cached to fall back to', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));

    await expect(users.load()).rejects.toThrow('network down');
  });

  it('writes the snapshot the next offline load reads', async () => {
    await users.load();

    await vi.waitFor(async () => {
      expect(await readUsersSnapshot(ACCOUNT_ID)).toEqual([
        { id: 'u-ada', name: 'Ada' },
        { id: 'u-brin', name: 'Brin' },
        { id: 'u-zed', name: 'Zed' },
      ]);
    });
  });
});
