import type { Context } from 'hono';
import { AppError } from '../utils/errors';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;

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

function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return c.req.header('x-real-ip') ?? 'unknown';
}

export function enforceAuthRateLimit(c: Context, email: string): void {
  const key = `${clientIp(c)}:${email.toLowerCase()}`;
  if (!consumeRateLimit(key)) {
    throw new AppError(429, 'Too many attempts, please try again later');
  }
}
