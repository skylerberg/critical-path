import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { getRedis, redisConfigured } from '../services/redis';
import { logger } from '../utils/logger';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
export const EMAIL_WINDOW_MS = 15 * 60_000;
export const EMAIL_MAX_ATTEMPTS = 30;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
    }
  }
}

function consumeRateLimitLocal(
  key: string,
  now: number,
  maxAttempts: number,
  windowMs: number
): boolean {
  sweep(now);
  const window = windows.get(key);
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  window.count++;
  return window.count <= maxAttempts;
}

// null means "no shared verdict" (Redis unconfigured or unreachable); the
// caller then falls back to the per-process window, which still bounds abuse
// per replica rather than failing closed on a Redis outage.
async function consumeRateLimitShared(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<boolean | null> {
  if (!redisConfigured()) {
    return null;
  }
  try {
    const redis = getRedis();
    const count = await redis.incr(`ratelimit:${key}`);
    if (count === 1) {
      await redis.pExpire(`ratelimit:${key}`, windowMs);
    }
    return count <= maxAttempts;
  } catch (err) {
    logger.warn({
      msg: 'Shared rate limit unavailable; using per-process fallback',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function consumeRateLimit(
  key: string,
  now = Date.now(),
  maxAttempts = MAX_ATTEMPTS,
  windowMs = WINDOW_MS
): Promise<boolean> {
  const shared = await consumeRateLimitShared(key, maxAttempts, windowMs);
  if (shared !== null) {
    return shared;
  }
  return consumeRateLimitLocal(key, now, maxAttempts, windowMs);
}

export function resetRateLimiter(): void {
  windows.clear();
  lastSweep = 0;
}

function socketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

function clientIp(c: Context): string {
  if (env.trustProxy) {
    // Entries left of the proxy-appended suffix are client-forgeable. GCP
    // HTTPS load balancers append "<client-ip>, <lb-ip>", hence hops=2 there.
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const entries = forwarded.split(',');
      const candidate = entries[entries.length - env.trustProxyHops]?.trim();
      if (candidate) {
        return candidate;
      }
    }
  }
  return socketAddress(c) ?? 'unknown';
}

export const RESET_IP_WINDOW_MS = 60 * 60_000;
export const RESET_IP_MAX_ATTEMPTS = 5;
export const RESET_EMAIL_WINDOW_MS = 60 * 60_000;
export const RESET_EMAIL_MAX_ATTEMPTS = 3;

// Returns shouldSend instead of throwing 429: a visible throttle status would
// leak which emails exist, so callers respond identically either way.
export async function enforceResetRateLimit(c: Context, email: string): Promise<boolean> {
  const now = Date.now();
  const ipAllowed = await consumeRateLimit(
    `reset-ip:${clientIp(c)}`,
    now,
    RESET_IP_MAX_ATTEMPTS,
    RESET_IP_WINDOW_MS
  );
  const emailAllowed = await consumeRateLimit(
    `reset-email:${email.toLowerCase()}`,
    now,
    RESET_EMAIL_MAX_ATTEMPTS,
    RESET_EMAIL_WINDOW_MS
  );
  return ipAllowed && emailAllowed;
}

export async function enforceAuthRateLimit(c: Context, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const ipAllowed = await consumeRateLimit(`ip:${clientIp(c)}:${normalizedEmail}`);
  // Second, IP-independent dimension: bounds total guesses against one
  // account even when attempts arrive from many distinct source IPs.
  const emailAllowed = await consumeRateLimit(
    `email:${normalizedEmail}`,
    Date.now(),
    EMAIL_MAX_ATTEMPTS,
    EMAIL_WINDOW_MS
  );
  if (!ipAllowed || !emailAllowed) {
    throw new AppError(429, 'Too many attempts, please try again later');
  }
}
