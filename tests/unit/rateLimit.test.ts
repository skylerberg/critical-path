import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  consumeRateLimit,
  enforceAuthRateLimit,
  enforceResetRateLimit,
  enforceSignupRateLimit,
  resetRateLimiter,
  EMAIL_MAX_ATTEMPTS,
  RESET_IP_MAX_ATTEMPTS,
  RESET_EMAIL_MAX_ATTEMPTS,
  SIGNUP_IP_MAX_ATTEMPTS,
} from '../../src/services/rateLimit';
import { errorHandler } from '../../src/middleware/errorHandler';

describe('consumeRateLimit', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('allows up to 10 attempts in a window and rejects the 11th', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(await consumeRateLimit('key', now + i)).toBe(true);
    }
    expect(await consumeRateLimit('key', now + 10)).toBe(false);
  });

  it('resets after the window expires', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 11; i++) {
      await consumeRateLimit('key', now);
    }
    expect(await consumeRateLimit('key', now)).toBe(false);
    expect(await consumeRateLimit('key', now + 60_001)).toBe(true);
  });

  it('tracks keys independently', async () => {
    const now = 1_000_000;
    for (let i = 0; i < 11; i++) {
      await consumeRateLimit('a', now);
    }
    expect(await consumeRateLimit('a', now)).toBe(false);
    expect(await consumeRateLimit('b', now)).toBe(true);
  });

  it('supports custom limits and windows', async () => {
    const now = 1_000_000;
    expect(await consumeRateLimit('key', now, 2, 1000)).toBe(true);
    expect(await consumeRateLimit('key', now, 2, 1000)).toBe(true);
    expect(await consumeRateLimit('key', now, 2, 1000)).toBe(false);
    expect(await consumeRateLimit('key', now + 1001, 2, 1000)).toBe(true);
  });
});

describe('enforceAuthRateLimit client IP derivation', () => {
  const app = new Hono();
  app.onError(errorHandler);
  app.post('/attempt', async (c) => {
    await enforceAuthRateLimit(c, 'victim@example.com');
    return c.body(null, 204);
  });

  async function attempt(headers: Record<string, string> = {}): Promise<Response> {
    return app.request('/attempt', { method: 'POST', headers });
  }

  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY_HOPS;
  });

  it('ignores forged X-Forwarded-For and X-Real-IP when TRUST_PROXY is off', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await attempt({
        'X-Forwarded-For': `1.2.3.${i}, 10.0.0.5`,
        'X-Real-IP': `2.3.4.${i}`,
      });
      expect(res.status).toBe(204);
    }

    const limited = await attempt({
      'X-Forwarded-For': '1.2.3.250, 10.0.0.5',
      'X-Real-IP': '2.3.4.250',
    });
    expect(limited.status).toBe(429);
  });

  it('uses the rightmost X-Forwarded-For entry when TRUST_PROXY is on', async () => {
    process.env.TRUST_PROXY = 'true';

    for (let i = 0; i < 10; i++) {
      const res = await attempt({ 'X-Forwarded-For': `1.2.3.${i}, 198.51.100.7` });
      expect(res.status).toBe(204);
    }

    const limited = await attempt({ 'X-Forwarded-For': '1.2.3.250, 198.51.100.7' });
    expect(limited.status).toBe(429);

    const otherClient = await attempt({ 'X-Forwarded-For': '1.2.3.250, 203.0.113.9' });
    expect(otherClient.status).toBe(204);
  });

  it('uses the entry TRUST_PROXY_HOPS from the right when set', async () => {
    process.env.TRUST_PROXY = 'true';
    process.env.TRUST_PROXY_HOPS = '2';

    for (let i = 0; i < 10; i++) {
      const res = await attempt({ 'X-Forwarded-For': `spoofed, 1.2.3.4, 130.211.0.${i}` });
      expect(res.status).toBe(204);
    }

    const limited = await attempt({ 'X-Forwarded-For': 'spoofed, 1.2.3.4, 130.211.0.99' });
    expect(limited.status).toBe(429);

    const otherClient = await attempt({ 'X-Forwarded-For': 'spoofed, 9.9.9.9, 130.211.0.99' });
    expect(otherClient.status).toBe(204);
  });

  it('falls back to the socket address when hops exceed the header entries', async () => {
    process.env.TRUST_PROXY = 'true';
    process.env.TRUST_PROXY_HOPS = '5';

    const res = await attempt({ 'X-Forwarded-For': '1.2.3.4, 5.6.7.8' });
    expect(res.status).toBe(204);
  });

  it('caps total attempts per email across distinct source IPs', async () => {
    process.env.TRUST_PROXY = 'true';

    for (let i = 0; i < EMAIL_MAX_ATTEMPTS; i++) {
      const res = await attempt({ 'X-Forwarded-For': `203.0.113.${i}` });
      expect(res.status).toBe(204);
    }

    const limited = await attempt({ 'X-Forwarded-For': '198.51.100.99' });
    expect(limited.status).toBe(429);
  });
});

describe('enforceResetRateLimit', () => {
  const app = new Hono();
  app.onError(errorHandler);
  app.post('/forgot/:email', async (c) => {
    await enforceResetRateLimit(c, c.req.param('email'));
    return c.body(null, 204);
  });

  async function attempt(email: string, headers: Record<string, string> = {}): Promise<number> {
    const res = await app.request(`/forgot/${email}`, { method: 'POST', headers });
    return res.status;
  }

  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it('refuses with 429 once the IP budget is spent', async () => {
    for (let i = 0; i < RESET_IP_MAX_ATTEMPTS; i++) {
      expect(await attempt(`user-${i}@example.com`)).toBe(204);
    }

    expect(await attempt('user-next@example.com')).toBe(429);
  });

  it('caps per email across distinct source IPs', async () => {
    process.env.TRUST_PROXY = 'true';

    for (let i = 0; i < RESET_EMAIL_MAX_ATTEMPTS; i++) {
      expect(await attempt('victim@example.com', { 'X-Forwarded-For': `203.0.113.${i}` })).toBe(
        204
      );
    }

    expect(await attempt('Victim@Example.com', { 'X-Forwarded-For': '198.51.100.50' })).toBe(429);

    expect(await attempt('other@example.com', { 'X-Forwarded-For': '198.51.100.51' })).toBe(204);
  });

  it('uses buckets independent of the auth limiter', async () => {
    for (let i = 0; i < RESET_EMAIL_MAX_ATTEMPTS; i++) {
      expect(await attempt('victim@example.com')).toBe(204);
    }
    expect(await attempt('victim@example.com')).toBe(429);

    const authApp = new Hono();
    authApp.onError(errorHandler);
    authApp.post('/attempt', async (c) => {
      await enforceAuthRateLimit(c, 'victim@example.com');
      return c.body(null, 204);
    });
    const res = await authApp.request('/attempt', { method: 'POST' });
    expect(res.status).toBe(204);
  });
});

describe('enforceSignupRateLimit', () => {
  const app = new Hono();
  app.onError(errorHandler);
  app.post('/signup', async (c) => {
    await enforceSignupRateLimit(c);
    return c.body(null, 204);
  });

  async function signUp(ip: string): Promise<number> {
    const res = await app.request('/signup', {
      method: 'POST',
      headers: { 'X-Forwarded-For': ip },
    });
    return res.status;
  }

  async function spendBudget(ip: string): Promise<void> {
    for (let i = 0; i < SIGNUP_IP_MAX_ATTEMPTS; i++) {
      expect(await signUp(ip)).toBe(204);
    }
  }

  beforeEach(() => {
    resetRateLimiter();
    process.env.TRUST_PROXY = 'true';
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it('refuses the request past the budget instead of letting it through', async () => {
    await spendBudget('203.0.113.1');
    expect(await signUp('203.0.113.1')).toBe(429);
  });

  it('leaves every other source IP a full budget once one has spent its own', async () => {
    await spendBudget('203.0.113.1');
    expect(await signUp('203.0.113.1')).toBe(429);

    expect(await signUp('198.51.100.9')).toBe(204);
  });

  // Elapsed times are written out rather than derived from the window constant,
  // which would move with any shortening of it.
  it('holds a spent budget for the hour rather than a minute', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await spendBudget('203.0.113.1');
      expect(await signUp('203.0.113.1')).toBe(429);

      clock.mockReturnValue(start + 30 * 60_000);
      expect(await signUp('203.0.113.1')).toBe(429);

      clock.mockReturnValue(start + 60 * 60_000 + 1);
      expect(await signUp('203.0.113.1')).toBe(204);
    } finally {
      clock.mockRestore();
    }
  });

  // Sharing a counter with the address-keyed limiter would make the generous
  // ceiling the effective bound on ordinary sign-in attempts too.
  it('spends a counter of its own, untouched by the auth limiter', async () => {
    const authApp = new Hono();
    authApp.onError(errorHandler);
    authApp.post('/attempt', async (c) => {
      await enforceAuthRateLimit(c, 'victim@example.com');
      return c.body(null, 204);
    });

    await spendBudget('203.0.113.1');
    expect(await signUp('203.0.113.1')).toBe(429);

    const res = await authApp.request('/attempt', {
      method: 'POST',
      headers: { 'X-Forwarded-For': '203.0.113.1' },
    });
    expect(res.status).toBe(204);
  });
});
