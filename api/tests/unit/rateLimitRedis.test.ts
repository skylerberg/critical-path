import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SimpleError } from 'redis';
import { consumeRateLimit, resetRateLimiter } from '../../src/middleware/rateLimit';
import { logger } from '../../src/utils/logger';
import { FakeRedis } from '../helpers/fakeRedis';

const state = vi.hoisted(() => ({ enabled: false, client: null as unknown }));

vi.mock('../../src/services/redis', () => ({
  redisConfigured: () => state.enabled,
  getRedis: () => state.client,
}));

const DEGRADED = 'Shared rate limit unavailable; using per-process fallback';

describe('the shared rate limit counter', () => {
  let redis: FakeRedis;

  beforeEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
    redis = new FakeRedis();
    state.enabled = true;
    state.client = redis;
  });

  it('counts against one shared key and stops at the limit', async () => {
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(false);
    expect(redis.store.get('ratelimit:key')?.value).toBe(2);
  });

  it('decides and counts in a single round trip', async () => {
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);

    expect(redis.roundTrips).toBe(1);
    expect(redis.keysWithoutExpiry()).toEqual([]);
    expect(redis.store.get('ratelimit:key')?.expiresAt).toBe(60_000);
  });

  // Seeded over the max: refusal is the verdict that strands the key, so a
  // counter repaired only where it is spent stays refusing forever.
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
    expect(warnings).toHaveBeenCalledWith(expect.objectContaining({ msg: DEGRADED }));
  });

  // A script that fails part-way answers the round trip rather than losing it.
  // Read as a verdict that reply allows everything; refused, the per-process
  // window still bounds it, per replica.
  it('falls back when the script answers with an error instead of a verdict', async () => {
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    redis.failFrom = 1;
    redis.failWith = new SimpleError('WRONGTYPE Operation against a key holding the wrong kind');

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    }
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(false);
    expect(warnings).toHaveBeenCalledWith(
      expect.objectContaining({ msg: DEGRADED, error: expect.stringContaining('WRONGTYPE') })
    );
  });

  it('falls back when the reply is not a position at all', async () => {
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    redis.replyWith = 'OK';

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(true);
    }
    expect(await consumeRateLimit('key', 0, 2, 60_000)).toBe(false);
    expect(warnings).toHaveBeenCalledWith(expect.objectContaining({ msg: DEGRADED }));
  });
});
