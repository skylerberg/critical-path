import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

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

export function consumeRateLimit(
  key: string,
  now = Date.now(),
  maxAttempts = MAX_ATTEMPTS,
  windowMs = WINDOW_MS
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
    // Rightmost entry: the address our own proxy observed. Leftmost entries
    // are client-supplied and trivially forged.
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const entries = forwarded.split(',');
      const last = entries[entries.length - 1].trim();
      if (last) {
        return last;
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
export function enforceResetRateLimit(c: Context, email: string): boolean {
  const now = Date.now();
  const ipAllowed = consumeRateLimit(
    `reset-ip:${clientIp(c)}`,
    now,
    RESET_IP_MAX_ATTEMPTS,
    RESET_IP_WINDOW_MS
  );
  const emailAllowed = consumeRateLimit(
    `reset-email:${email.toLowerCase()}`,
    now,
    RESET_EMAIL_MAX_ATTEMPTS,
    RESET_EMAIL_WINDOW_MS
  );
  return ipAllowed && emailAllowed;
}

export function enforceAuthRateLimit(c: Context, email: string): void {
  const normalizedEmail = email.toLowerCase();
  const ipAllowed = consumeRateLimit(`ip:${clientIp(c)}:${normalizedEmail}`);
  // Second, IP-independent dimension: bounds total guesses against one
  // account even when attempts arrive from many distinct source IPs.
  const emailAllowed = consumeRateLimit(
    `email:${normalizedEmail}`,
    Date.now(),
    EMAIL_MAX_ATTEMPTS,
    EMAIL_WINDOW_MS
  );
  if (!ipAllowed || !emailAllowed) {
    throw new AppError(429, 'Too many attempts, please try again later');
  }
}
