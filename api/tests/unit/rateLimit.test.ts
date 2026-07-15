import { describe, it, expect, beforeEach } from 'vitest';
import { consumeRateLimit, resetRateLimiter } from '../../src/middleware/rateLimit';

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
