import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  consumeRateLimit,
  enforceAuthRateLimit,
  enforceResetRateLimit,
  resetRateLimiter,
  EMAIL_MAX_ATTEMPTS,
  RESET_IP_MAX_ATTEMPTS,
  RESET_EMAIL_MAX_ATTEMPTS,
} from '../../src/middleware/rateLimit';
import { errorHandler } from '../../src/middleware/errorHandler';

describe('consumeRateLimit', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  it('allows up to 10 attempts in a window and rejects the 11th', () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) {
      expect(consumeRateLimit('key', now + i)).toBe(true);
    }
    expect(consumeRateLimit('key', now + 10)).toBe(false);
  });

  it('resets after the window expires', () => {
    const now = 1_000_000;
    for (let i = 0; i < 11; i++) {
      consumeRateLimit('key', now);
    }
    expect(consumeRateLimit('key', now)).toBe(false);
    expect(consumeRateLimit('key', now + 60_001)).toBe(true);
  });

  it('tracks keys independently', () => {
    const now = 1_000_000;
    for (let i = 0; i < 11; i++) {
      consumeRateLimit('a', now);
    }
    expect(consumeRateLimit('a', now)).toBe(false);
    expect(consumeRateLimit('b', now)).toBe(true);
  });

  it('supports custom limits and windows', () => {
    const now = 1_000_000;
    expect(consumeRateLimit('key', now, 2, 1000)).toBe(true);
    expect(consumeRateLimit('key', now, 2, 1000)).toBe(true);
    expect(consumeRateLimit('key', now, 2, 1000)).toBe(false);
    expect(consumeRateLimit('key', now + 1001, 2, 1000)).toBe(true);
  });
});

describe('enforceAuthRateLimit client IP derivation', () => {
  const app = new Hono();
  app.onError(errorHandler);
  app.post('/attempt', (c) => {
    enforceAuthRateLimit(c, 'victim@example.com');
    return c.body(null, 204);
  });

  function attempt(headers: Record<string, string> = {}): Promise<Response> {
    return app.request('/attempt', { method: 'POST', headers });
  }

  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
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
  app.post('/forgot/:email', (c) => {
    const shouldSend = enforceResetRateLimit(c, c.req.param('email'));
    return c.json({ shouldSend }, 200);
  });

  async function attempt(
    email: string,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; shouldSend: boolean }> {
    const res = await app.request(`/forgot/${email}`, { method: 'POST', headers });
    const body = (await res.json()) as { shouldSend: boolean };
    return { status: res.status, shouldSend: body.shouldSend };
  }

  beforeEach(() => {
    resetRateLimiter();
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it('returns false instead of erroring once the IP budget is spent', async () => {
    for (let i = 0; i < RESET_IP_MAX_ATTEMPTS; i++) {
      const res = await attempt(`user-${i}@example.com`);
      expect(res).toEqual({ status: 200, shouldSend: true });
    }

    const throttled = await attempt('user-next@example.com');
    expect(throttled).toEqual({ status: 200, shouldSend: false });
  });

  it('caps per email across distinct source IPs', async () => {
    process.env.TRUST_PROXY = 'true';

    for (let i = 0; i < RESET_EMAIL_MAX_ATTEMPTS; i++) {
      const res = await attempt('victim@example.com', { 'X-Forwarded-For': `203.0.113.${i}` });
      expect(res.shouldSend).toBe(true);
    }

    const throttled = await attempt('Victim@Example.com', {
      'X-Forwarded-For': '198.51.100.50',
    });
    expect(throttled.shouldSend).toBe(false);

    const otherEmail = await attempt('other@example.com', {
      'X-Forwarded-For': '198.51.100.51',
    });
    expect(otherEmail.shouldSend).toBe(true);
  });

  it('uses buckets independent of the auth limiter', async () => {
    for (let i = 0; i < RESET_EMAIL_MAX_ATTEMPTS; i++) {
      expect((await attempt('victim@example.com')).shouldSend).toBe(true);
    }
    expect((await attempt('victim@example.com')).shouldSend).toBe(false);

    const authApp = new Hono();
    authApp.onError(errorHandler);
    authApp.post('/attempt', (c) => {
      enforceAuthRateLimit(c, 'victim@example.com');
      return c.body(null, 204);
    });
    const res = await authApp.request('/attempt', { method: 'POST' });
    expect(res.status).toBe(204);
  });
});
