import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  withNotificationBudget,
  resetRateLimiter,
  NOTIFY_PAIR_MAX_ATTEMPTS,
  NOTIFY_RECIPIENT_MAX_ATTEMPTS,
} from '../../src/middleware/rateLimit';
import { logger } from '../../src/utils/logger';
import { FakeRedis } from '../helpers/fakeRedis';

const state = vi.hoisted(() => ({ enabled: false, client: null as unknown }));

vi.mock('../../src/services/redis', () => ({
  redisConfigured: () => state.enabled,
  getRedis: () => state.client,
}));

const VICTIM = 'recipient-1';
const DEGRADED = 'Shared rate limit unavailable; using per-process fallback';

async function deliver(actorId: string, repeatKey: string, send?: () => Promise<void>) {
  let sent = false;
  await withNotificationBudget(VICTIM, actorId, repeatKey, async () => {
    sent = true;
    await send?.();
  });
  return sent;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe.each([
  ['with a shared counter', true],
  ['with the per-process window', false],
])('the notification budgets %s', (_name, shared) => {
  let redis: FakeRedis;
  let warnings: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetRateLimiter();
    vi.restoreAllMocks();
    warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    redis = new FakeRedis();
    state.enabled = shared;
    state.client = redis;
  });

  // Without this the shared configuration proves nothing: a limiter that never
  // reached Redis quietly answers from the per-process window instead, which is
  // the one arrangement where deciding across two round trips looks correct.
  afterEach(() => {
    if (!shared) return;
    expect(redis.roundTrips).toBeGreaterThan(0);
    expect(warnings).not.toHaveBeenCalledWith(expect.objectContaining({ msg: DEGRADED }));
  });

  it('collapses two identical notifications that arrive together', async () => {
    const verdicts = await Promise.all([deliver('actor-1', 'card'), deliver('actor-2', 'card')]);

    expect(verdicts.filter(Boolean)).toHaveLength(1);
  });

  it('collapses a duplicate that starts while the first is still deciding', async () => {
    const first = deliver('actor-1', 'card');
    await tick();
    const second = deliver('actor-2', 'card');

    expect((await Promise.all([first, second])).filter(Boolean)).toHaveLength(1);
  });

  it('holds one sender to their share however many arrive at once', async () => {
    const verdicts = await Promise.all(
      Array.from({ length: NOTIFY_PAIR_MAX_ATTEMPTS * 10 }, (_unused, index) =>
        deliver('actor-1', `card-${String(index)}`)
      )
    );

    expect(verdicts.filter(Boolean)).toHaveLength(NOTIFY_PAIR_MAX_ATTEMPTS);
  });

  it('holds one mailbox to its ceiling however many senders arrive at once', async () => {
    const verdicts = await Promise.all(
      Array.from({ length: NOTIFY_RECIPIENT_MAX_ATTEMPTS * 5 }, (_unused, index) =>
        deliver(`actor-${String(index)}`, `card-${String(index)}`)
      )
    );

    expect(verdicts.filter(Boolean)).toHaveLength(NOTIFY_RECIPIENT_MAX_ATTEMPTS);
  });

  it('leaves the collapse slot unspent when another budget refuses', async () => {
    for (let index = 0; index < NOTIFY_PAIR_MAX_ATTEMPTS; index++) {
      expect(await deliver('spender', `card-${String(index)}`)).toBe(true);
    }

    expect(await deliver('spender', 'urgent')).toBe(false);
    expect(await deliver('colleague', 'urgent')).toBe(true);
  });

  it('spends nothing when the send itself fails', async () => {
    const boom = () => Promise.reject(new Error('smtp is down'));

    for (let index = 0; index < NOTIFY_PAIR_MAX_ATTEMPTS + 5; index++) {
      await expect(deliver('spender', 'urgent', boom)).rejects.toThrow('smtp is down');
    }

    expect(await deliver('spender', 'urgent')).toBe(true);
  });

  it('names the sender that was refused when a mailbox hits its ceiling', async () => {
    for (let index = 0; index < NOTIFY_RECIPIENT_MAX_ATTEMPTS; index++) {
      expect(await deliver(`actor-${String(index)}`, `card-${String(index)}`)).toBe(true);
    }

    expect(await deliver('late-sender', 'late-card')).toBe(false);
    expect(warnings).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'Notification email dropped: this recipient is over their total budget',
        recipient_id: VICTIM,
        actor_id: 'late-sender',
      })
    );
  });

  it('names many senders for one silenced mailbox, but not without end', async () => {
    for (let index = 0; index < NOTIFY_RECIPIENT_MAX_ATTEMPTS; index++) {
      await deliver(`actor-${String(index)}`, `card-${String(index)}`);
    }

    for (let index = 0; index < 40; index++) {
      await deliver(`farm-${String(index)}`, `farm-card-${String(index)}`);
    }

    const silenced = warnings.mock.calls
      .map(([fields]) => fields as { msg: string; actor_id?: string })
      .filter((fields) => fields.msg.includes('over their total budget'));
    expect(silenced.length).toBeGreaterThan(1);
    expect(silenced.length).toBeLessThan(40);
    expect(new Set(silenced.map((fields) => fields.actor_id)).size).toBe(silenced.length);
  });
});
