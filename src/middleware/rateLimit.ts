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

async function peekRateLimitShared(key: string, maxAttempts: number): Promise<boolean | null> {
  if (!redisConfigured()) {
    return null;
  }
  try {
    const count = await getRedis().get(`ratelimit:${key}`);
    return count === null || Number(count) < maxAttempts;
  } catch (err) {
    logger.warn({
      msg: 'Shared rate limit unavailable; using per-process fallback',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// For a budget that has to gate a call it may turn out not to be spent on.
export async function peekRateLimit(
  key: string,
  now = Date.now(),
  maxAttempts = MAX_ATTEMPTS
): Promise<boolean> {
  const shared = await peekRateLimitShared(key, maxAttempts);
  if (shared !== null) {
    return shared;
  }
  const window = windows.get(key);
  return window === undefined || window.resetAt <= now || window.count < maxAttempts;
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

export const VERIFY_USER_WINDOW_MS = 60 * 60_000;
export const VERIFY_USER_MAX_ATTEMPTS = 3;
export const VERIFY_IP_WINDOW_MS = 60 * 60_000;
export const VERIFY_IP_MAX_ATTEMPTS = 10;

// Throws rather than returning a verdict: the caller is authenticated and the
// address is their own, so a visible 429 is no oracle.
export async function enforceVerificationRateLimit(c: Context, userId: string): Promise<void> {
  const now = Date.now();
  const userAllowed = await consumeRateLimit(
    `verify-user:${userId}`,
    now,
    VERIFY_USER_MAX_ATTEMPTS,
    VERIFY_USER_WINDOW_MS
  );
  const ipAllowed = await consumeRateLimit(
    `verify-ip:${clientIp(c)}`,
    now,
    VERIFY_IP_MAX_ATTEMPTS,
    VERIFY_IP_WINDOW_MS
  );
  if (!userAllowed || !ipAllowed) {
    throw new AppError(429, 'Too many verification emails, please try again later');
  }
}

export const SIGNUP_VERIFY_IP_WINDOW_MS = 60 * 60_000;
// No looser than the authenticated one above: this one mails addresses nobody
// has consented to, which is the more dangerous of the two.
export const SIGNUP_VERIFY_IP_MAX_ATTEMPTS = VERIFY_IP_MAX_ATTEMPTS;

// Returns shouldSend rather than throwing, on its own counter: signup is
// unauthenticated, so denying the operation would let anyone burn a shared
// egress IP's budget to keep everyone behind it from registering — and spending
// the authenticated verification budget here would do that to their resends.
export async function enforceSignupVerificationRateLimit(c: Context): Promise<boolean> {
  const ip = clientIp(c);
  const now = Date.now();
  const allowed = await consumeRateLimit(
    `signup-verify-ip:${ip}`,
    now,
    SIGNUP_VERIFY_IP_MAX_ATTEMPTS,
    SIGNUP_VERIFY_IP_WINDOW_MS
  );
  // A withheld send is otherwise indistinguishable from an ordinary signup; the
  // second counter surfaces that once a window rather than on every request.
  if (
    !allowed &&
    (await consumeRateLimit(`signup-verify-log:${ip}`, now, 1, SIGNUP_VERIFY_IP_WINDOW_MS))
  ) {
    logger.warn({ msg: 'Withheld signup verification email: per-IP budget spent', ip });
  }
  return allowed;
}

export const INVITE_LOOKUP_WINDOW_MS = 60 * 60_000;
export const INVITE_LOOKUP_MAX_ATTEMPTS = 100;
export const INVITE_SEND_WINDOW_MS = 60 * 60_000;
export const INVITE_SEND_MAX_ATTEMPTS = 20;
export const INVITE_RESEND_WINDOW_MS = 60 * 60_000;
export const INVITE_RESEND_MAX_ATTEMPTS = 3;

// Metered apart from mail because they are different harms: this bounds how
// fast a share attempt can be used to tell an address with an account from one
// without, and every attempt spends it whatever the answer, so no reply about
// an address is free. Sized for onboarding a team in one sitting.
export async function enforceInvitationLookupRateLimit(userId: string): Promise<void> {
  const allowed = await consumeRateLimit(
    `invite-lookup:${userId}`,
    Date.now(),
    INVITE_LOOKUP_MAX_ATTEMPTS,
    INVITE_LOOKUP_WINDOW_MS
  );
  if (!allowed) {
    throw new AppError(429, 'Too many invitations, please try again later');
  }
}

const inviteSendKey = (userId: string): string => `invite-send:${userId}`;

// Refuses every caller alike once the mail budget is gone, including the ones
// whose call would never have sent anything: a budget that only turned away the
// addresses with no account would make its own 429 the answer about an address.
export async function assertInvitationSendBudget(userId: string): Promise<void> {
  const remaining = await peekRateLimit(
    inviteSendKey(userId),
    Date.now(),
    INVITE_SEND_MAX_ATTEMPTS
  );
  if (!remaining) {
    throw new AppError(429, 'Too many invitations, please try again later');
  }
}

// Spent only where mail actually goes out, since this is the only path that
// mails an address nobody has proved they control.
export async function enforceInvitationSendRateLimit(userId: string): Promise<void> {
  const allowed = await consumeRateLimit(
    inviteSendKey(userId),
    Date.now(),
    INVITE_SEND_MAX_ATTEMPTS,
    INVITE_SEND_WINDOW_MS
  );
  if (!allowed) {
    throw new AppError(429, 'Too many invitations, please try again later');
  }
}

// Tighter, and keyed on the invitation rather than the caller: the inviter's
// hourly total does not stop one address being mailed the same link over and
// over, by them or by a second editor.
export async function enforceInvitationResendRateLimit(invitationId: string): Promise<void> {
  const allowed = await consumeRateLimit(
    `invite-resend:${invitationId}`,
    Date.now(),
    INVITE_RESEND_MAX_ATTEMPTS,
    INVITE_RESEND_WINDOW_MS
  );
  if (!allowed) {
    throw new AppError(429, 'Too many invitations, please try again later');
  }
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
