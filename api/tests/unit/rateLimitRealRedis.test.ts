import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { consumeBudgets, consumeRateLimit, resetRateLimiter } from '../../src/services/rateLimit';
import { withNotificationBudget } from '../../src/services/notificationBudget';
import { logger } from '../../src/utils/logger';
import { closeRealRedis, openRealRedis, realRedisPrefix, redisTestUrl } from '../helpers/realRedis';

const state = vi.hoisted(() => ({ enabled: false, client: null as unknown }));

vi.mock('../../src/services/redis', () => ({
  redisConfigured: () => state.enabled,
  getRedis: () => state.client,
}));

const DEGRADED = 'Shared rate limit unavailable; using per-process fallback';

// Written straight to the stream: the runner swallows console output from a
// file in which nothing ends up running, which is exactly this case.
if (!redisTestUrl) {
  process.stderr.write('REDIS_TEST_URL is unset; skipping every check that needs a real Redis\n');
}

// Skipping is the local convenience, not a way for CI to lose the coverage
// without saying so.
describe('a run that has to have a real Redis', () => {
  it.runIf(process.env.CI)('finds one it can reach', async () => {
    expect(redisTestUrl).toBeTruthy();
    const client = await openRealRedis();
    try {
      expect(await client.ping()).toBe('PONG');
    } finally {
      await client.close();
    }
  });
});

describe.skipIf(!redisTestUrl)('the shipped rate limit scripts on a real Redis', () => {
  let client!: Awaited<ReturnType<typeof openRealRedis>>;
  let warnings: ReturnType<typeof vi.spyOn>;
  const prefix = realRedisPrefix();

  const named = (name: string): string => `${prefix}${name}`;
  const stored = (name: string): Promise<string | null> => client.get(`ratelimit:${named(name)}`);
  const ttl = (name: string): Promise<number> => client.pTTL(`ratelimit:${named(name)}`);

  beforeAll(async () => {
    client = await openRealRedis();
    state.client = client;
  });

  afterAll(async () => {
    state.enabled = false;
    state.client = null;
    if (client) await closeRealRedis(client, prefix);
  });

  beforeEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
    warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    state.enabled = true;
  });

  // Second net only. Every test below also reads the server back, because a
  // verdict alone reads the same whether it came from Redis or from the
  // per-process window this falls back to.
  afterEach(() => {
    expect(warnings).not.toHaveBeenCalledWith(expect.objectContaining({ msg: DEGRADED }));
  });

  it('answers a verdict the caller accepts and leaves the count on the server', async () => {
    expect(await consumeRateLimit(named('cap'), Date.now(), 2, 60_000)).toBe(true);
    expect(await consumeRateLimit(named('cap'), Date.now(), 2, 60_000)).toBe(true);
    expect(await consumeRateLimit(named('cap'), Date.now(), 2, 60_000)).toBe(false);

    expect(await stored('cap')).toBe('2');
    expect(await ttl('cap')).toBeGreaterThan(0);
    expect(await ttl('cap')).toBeLessThanOrEqual(60_000);
  });

  it('gives an expiry back to a counter left without one, while refusing it', async () => {
    await client.set(`ratelimit:${named('stranded')}`, '9');
    expect(await ttl('stranded')).toBe(-1);

    expect(await consumeRateLimit(named('stranded'), Date.now(), 2, 60_000)).toBe(false);

    expect(await ttl('stranded')).toBeGreaterThan(0);
    expect(await ttl('stranded')).toBeLessThanOrEqual(60_000);
    expect(await stored('stranded')).toBe('9');
  });

  // The expiry it must not touch is set to a value the window never produces,
  // so a slid one is 55 seconds out rather than one round trip out.
  it('holds the expiry a live counter already has rather than sliding it', async () => {
    await consumeRateLimit(named('slide'), Date.now(), 5, 60_000);
    await client.pExpire(`ratelimit:${named('slide')}`, 5_000);

    await consumeRateLimit(named('slide'), Date.now(), 5, 60_000);

    expect(await ttl('slide')).toBeGreaterThan(0);
    expect(await ttl('slide')).toBeLessThanOrEqual(5_000);
    expect(await stored('slide')).toBe('2');
  });

  // The window is a minute and the key is then expired outright, rather than a
  // 250ms window slept through: two round trips racing a quarter-second budget
  // decide this test on how loaded the machine is, and it is Redis dropping the
  // key that it is actually about.
  it("lets the budget back once the server's own clock has passed the window", async () => {
    expect(await consumeRateLimit(named('expiry'), Date.now(), 1, 60_000)).toBe(true);
    expect(await consumeRateLimit(named('expiry'), Date.now(), 1, 60_000)).toBe(false);
    expect(await stored('expiry')).toBe('1');

    await client.pExpire(`ratelimit:${named('expiry')}`, 1);
    await vi.waitFor(async () => {
      expect(await stored('expiry')).toBeNull();
    });

    expect(await consumeRateLimit(named('expiry'), Date.now(), 1, 60_000)).toBe(true);
  });

  // Nothing serializes these but the script itself, and each one is a real
  // round trip that the next can overtake.
  it('holds the ceiling with every attempt in flight at once', async () => {
    const max = 20;
    const verdicts = await Promise.all(
      Array.from({ length: max * 10 }, () =>
        consumeRateLimit(named('parallel'), Date.now(), max, 60_000)
      )
    );

    expect(verdicts.filter(Boolean)).toHaveLength(max);
    expect(await stored('parallel')).toBe(String(max));
  });

  // A second module instance is a second replica: its per-process window is
  // empty, so a refusal can only have come from the counter they share.
  it('refuses a replica that has spent nothing of its own', async () => {
    const key = named('replica');
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(await consumeRateLimit(key, Date.now(), 3, 60_000)).toBe(true);
    }

    vi.resetModules();
    const replica = await import('../../src/services/rateLimit');

    expect(await replica.consumeRateLimit(key, Date.now(), 3, 60_000)).toBe(false);
    expect(await replica.consumeRateLimit(named('untouched'), Date.now(), 3, 60_000)).toBe(true);
  });

  it('answers a peek from the shared counter rather than a local window', async () => {
    const key = named('peek');
    expect(await consumeRateLimit(key, Date.now(), 2, 60_000)).toBe(true);

    vi.resetModules();
    const replica = await import('../../src/services/rateLimit');

    // One of two spent. A reply this cannot read as a number compares false
    // here and refuses every caller from now on, with nothing thrown to notice.
    expect(await replica.peekRateLimit(key, Date.now(), 2)).toBe(true);

    expect(await consumeRateLimit(key, Date.now(), 2, 60_000)).toBe(true);
    expect(await replica.peekRateLimit(key, Date.now(), 2)).toBe(false);
  });

  it('hands the collapse slot back on the server when the send fails', async () => {
    const recipient = named('refund');
    const collapse = `ratelimit:notify-repeat:${recipient}:card`;

    await expect(
      withNotificationBudget(recipient, 'actor', 'card', () =>
        Promise.reject(new Error('smtp is down'))
      )
    ).rejects.toThrow('smtp is down');

    expect(await client.get(collapse)).toBe('0');
    expect(await client.pTTL(collapse)).toBeGreaterThan(0);

    let sent = false;
    await withNotificationBudget(recipient, 'actor', 'card', async () => {
      sent = true;
      await Promise.resolve();
    });
    expect(sent).toBe(true);
  });

  it('leaves a counter that expired mid-send alone instead of recreating it', async () => {
    const recipient = named('refund-expired');
    const collapse = `ratelimit:notify-repeat:${recipient}:card`;

    await expect(
      withNotificationBudget(recipient, 'actor', 'card', async () => {
        await client.unlink(collapse);
        throw new Error('smtp is down');
      })
    ).rejects.toThrow('smtp is down');

    expect(await client.get(collapse)).toBeNull();
    expect(await client.pTTL(collapse)).toBe(-2);
    expect(await client.get(`ratelimit:notify-pair:${recipient}:actor`)).toBe('1');
  });
  // The reason a budget carries its own window: the auth limiter spends three
  // that reset a minute, a quarter of an hour and an hour apart, and before this
  // it could only spend them one call at a time — which is how an attempt the
  // first one refused still drew down the third.
  it('gives each budget in one set the expiry that belongs to it', async () => {
    const minute = named('mixed-minute');
    const hour = named('mixed-hour');

    expect(
      await consumeBudgets(
        [
          { key: minute, max: 5, windowMs: 60_000 },
          { key: hour, max: 100, windowMs: 3_600_000 },
        ],
        Date.now()
      )
    ).toBeNull();

    expect(await stored('mixed-minute')).toBe('1');
    expect(await stored('mixed-hour')).toBe('1');
    expect(await ttl('mixed-minute')).toBeGreaterThan(50_000);
    expect(await ttl('mixed-minute')).toBeLessThanOrEqual(60_000);
    expect(await ttl('mixed-hour')).toBeGreaterThan(3_500_000);
    expect(await ttl('mixed-hour')).toBeLessThanOrEqual(3_600_000);
  });

  // Pinned here as well as in the fallback's own tests: this is the input where
  // the two could disagree with no caller the wiser.
  it('refuses a budget of zero with no counter stored yet', async () => {
    expect(
      await consumeBudgets([{ key: named('never'), max: 0, windowMs: 60_000 }], Date.now())
    ).toMatchObject({ key: named('never') });
    expect(await stored('never')).toBeNull();
  });

  it('spends none of a mixed-window set when any one of them is full', async () => {
    const short = named('atomic-short');
    const long = named('atomic-long');
    const budgets = [
      { key: short, max: 1, windowMs: 60_000 },
      { key: long, max: 100, windowMs: 3_600_000 },
    ];

    expect(await consumeBudgets(budgets, Date.now())).toBeNull();
    expect(await consumeBudgets(budgets, Date.now())).toMatchObject({ key: short });

    // The refusal cost the long budget nothing, which is the property the auth
    // limiter depends on: a refused sign-in never reaches a password hash, so it
    // must not draw down the ceiling a whole office shares.
    expect(await stored('atomic-long')).toBe('1');
  });
});
