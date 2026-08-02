import { describe, it, expect, beforeEach, vi } from 'vitest';
import { consumeRateLimit, resetRateLimiter } from '../../src/middleware/rateLimit';
import { logger } from '../../src/utils/logger';

interface Entry {
  value: number;
  expiresAt: number | null;
}

// The suite configures no Redis, so the shared path has no coverage from a real
// server. This stands in for one: INCR, PEXPIRE with its NX condition and GET,
// each as one round trip that can be made to fail.
class FakeRedis {
  readonly store = new Map<string, Entry>();
  now = 0;
  roundTrips = 0;
  failFrom: number | null = null;

  live(key: string): Entry | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  applyIncr(key: string): number {
    const entry = this.live(key);
    if (entry === undefined) {
      this.store.set(key, { value: 1, expiresAt: null });
      return 1;
    }
    entry.value += 1;
    return entry.value;
  }

  applyPExpire(key: string, ms: number, mode?: string): number {
    const entry = this.live(key);
    if (entry === undefined) return 0;
    if (mode === 'NX' && entry.expiresAt !== null) return 0;
    entry.expiresAt = this.now + ms;
    return 1;
  }

  roundTrip(): void {
    this.roundTrips += 1;
    if (this.failFrom !== null && this.roundTrips >= this.failFrom) {
      throw new Error('connection lost');
    }
  }

  get(key: string): Promise<string | null> {
    this.roundTrip();
    const entry = this.live(key);
    return Promise.resolve(entry === undefined ? null : String(entry.value));
  }

  incr(key: string): Promise<number> {
    this.roundTrip();
    return Promise.resolve(this.applyIncr(key));
  }

  pExpire(key: string, ms: number, mode?: string): Promise<number> {
    this.roundTrip();
    return Promise.resolve(this.applyPExpire(key, ms, mode));
  }

  multi(): FakeMulti {
    return new FakeMulti(this);
  }

  keysWithoutExpiry(): string[] {
    return [...this.store].filter(([, entry]) => entry.expiresAt === null).map(([key]) => key);
  }
}

class FakeMulti {
  readonly #redis: FakeRedis;
  readonly #queued: Array<() => number> = [];

  constructor(redis: FakeRedis) {
    this.#redis = redis;
  }

  incr(key: string): this {
    this.#queued.push(() => this.#redis.applyIncr(key));
    return this;
  }

  pExpire(key: string, ms: number, mode?: string): this {
    this.#queued.push(() => this.#redis.applyPExpire(key, ms, mode));
    return this;
  }

  exec(): Promise<number[]> {
    this.#redis.roundTrip();
    return Promise.resolve(this.#queued.map((run) => run()));
  }
}

const state = vi.hoisted(() => ({ enabled: false, client: null as unknown }));

vi.mock('../../src/services/redis', () => ({
  redisConfigured: () => state.enabled,
  getRedis: () => state.client,
}));

describe('the shared rate limit counter', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
    redis = new FakeRedis();
    state.enabled = true;
    state.client = redis;
  });

  it('counts against one shared key and refuses past the limit', async () => {
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(false);
    expect(redis.store.get('ratelimit:key')?.value).toBe(3);
  });

  it('leaves no counter without an expiry when a round trip is lost', async () => {
    redis.failFrom = 2;

    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);

    expect(redis.keysWithoutExpiry()).toEqual([]);
    expect(redis.store.get('ratelimit:key')?.expiresAt).toBe(60_000);
  });

  it('gives an expiry back to a counter left without one', async () => {
    redis.store.set('ratelimit:key', { value: 9, expiresAt: null });

    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(false);
    expect(redis.store.get('ratelimit:key')?.expiresAt).toBe(60_000);

    redis.now = 60_001;
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
  });

  it('holds the expiry the counter started with rather than sliding it', async () => {
    await consumeRateLimit('key', 0, 2, 60_000);
    redis.now = 30_000;
    await consumeRateLimit('key', 0, 2, 60_000);

    expect(redis.store.get('ratelimit:key')?.expiresAt).toBe(60_000);
  });

  it('falls back to the per-process window while Redis is unreachable', async () => {
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    redis.failFrom = 1;

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    }
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(false);
    expect(warnings).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'Shared rate limit unavailable; using per-process fallback' })
    );
  });
});
