import type { Context } from 'hono';
import { AppError, errorText } from '../utils/errors';
import { clientIp } from './clientIp';
import { getRedis, redisConfigured } from './redis';
import { logger } from '../utils/logger';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const EMAIL_WINDOW_MS = 15 * 60_000;
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

// A budget carries its own window, so budgets that reset on different schedules
// can still be spent as one. Without that, the caller with the most to gain from
// atomicity — the auth limiter, whose three windows are a minute, a quarter of
// an hour and an hour — was the one caller that had to spend them one at a time.
export interface Budget {
  key: string;
  max: number;
  windowMs: number;
}

// Answers 0, or the 1-based position of the first full budget, having spent
// nothing. One script rather than GET-then-INCR: over a network that gap is a
// round trip wide. Every key gets an expiry if it has none, whatever the
// verdict — one that lost its expiry never resets, and repairing only what gets
// spent would strand exactly the full ones. Sent in full rather than by hash: a
// NOSCRIPT reply after a Redis restart would silently drop every budget back to
// the per-process window.
//
// ARGV is the maxima followed by the windows, so ARGV[i] and ARGV[n + i] are the
// two halves of budget i.
const CONSUME_SCRIPT = `
local n = #KEYS
local refused = 0
for i = 1, n do
  redis.call('PEXPIRE', KEYS[i], ARGV[n + i], 'NX')
  if refused == 0 and tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    refused = i
  end
end
if refused > 0 then
  return refused
end
for i = 1, n do
  redis.call('INCR', KEYS[i])
  redis.call('PEXPIRE', KEYS[i], ARGV[n + i], 'NX')
end
return 0
`;

// Guarded rather than a plain DECR: on an already-expired key that would
// recreate it at -1 with no expiry at all.
const REFUND_SCRIPT = `
for i = 1, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') > 0 then
    redis.call('DECR', KEYS[i])
  end
end
return 0
`;

// null means "no shared verdict" (Redis unconfigured or unreachable); the caller
// falls back to the per-process window rather than failing closed on an outage.
async function runShared(
  script: string,
  budgets: Budget[],
  args: string[]
): Promise<number | null> {
  if (!redisConfigured()) {
    return null;
  }
  try {
    const reply = await getRedis().eval(script, {
      keys: budgets.map((budget) => `ratelimit:${budget.key}`),
      arguments: args,
    });
    // An error reply arrives as a normal completion, not a lost connection.
    if (typeof reply !== 'number' || reply < 0 || reply > budgets.length) {
      throw new Error(`Unreadable rate limit reply: ${JSON.stringify(reply)}`);
    }
    return reply;
  } catch (err) {
    logger.warn({
      msg: 'Shared rate limit unavailable; using per-process fallback',
      error: errorText(err),
    });
    return null;
  }
}

function consumeBudgetsLocal(budgets: Budget[], now: number): number {
  sweep(now);
  for (const [index, budget] of budgets.entries()) {
    const window = windows.get(budget.key);
    // A key that is absent or past its window counts as zero, which is what the
    // script's `GET ... or '0'` does. Reading it as "not full" instead let a
    // budget of zero admit its first attempt here and refuse it on Redis — the
    // fallback answering a different policy than the thing it stands in for.
    const spent = window !== undefined && window.resetAt > now ? window.count : 0;
    if (spent >= budget.max) {
      return index + 1;
    }
  }
  for (const budget of budgets) {
    const window = windows.get(budget.key);
    if (window === undefined || window.resetAt <= now) {
      windows.set(budget.key, { count: 1, resetAt: now + budget.windowMs });
    } else {
      window.count++;
    }
  }
  return 0;
}

// All or nothing, so an attempt one budget refuses never spends another's slot.
// That is the whole reason to spend a set together: budgets consumed one call at
// a time each charge for an attempt the next one is about to refuse, which for
// the auth limiter meant a request that never reached a password hash still
// drawing down the ceiling every caller at its address shares.
export async function consumeBudgets(budgets: Budget[], now: number): Promise<Budget | null> {
  const args = [
    ...budgets.map((budget) => String(budget.max)),
    ...budgets.map((budget) => String(budget.windowMs)),
  ];
  const shared = await runShared(CONSUME_SCRIPT, budgets, args);
  const refused = shared ?? consumeBudgetsLocal(budgets, now);
  return refused === 0 ? null : budgets[refused - 1];
}

export async function refundBudgets(budgets: Budget[], now: number): Promise<void> {
  if ((await runShared(REFUND_SCRIPT, budgets, [])) !== null) {
    return;
  }
  for (const budget of budgets) {
    const window = windows.get(budget.key);
    if (window !== undefined && window.resetAt > now && window.count > 0) {
      window.count--;
    }
  }
}

export async function consumeRateLimit(
  key: string,
  now = Date.now(),
  maxAttempts = MAX_ATTEMPTS,
  windowMs = WINDOW_MS
): Promise<boolean> {
  return (await consumeBudgets([{ key, max: maxAttempts, windowMs }], now)) === null;
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
      error: errorText(err),
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

const RESET_IP_WINDOW_MS = 60 * 60_000;
export const RESET_IP_MAX_ATTEMPTS = 5;
const RESET_EMAIL_WINDOW_MS = 60 * 60_000;
export const RESET_EMAIL_MAX_ATTEMPTS = 3;

export async function enforceResetRateLimit(c: Context, email: string): Promise<void> {
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
  if (!ipAllowed || !emailAllowed) {
    throw new AppError(429, 'Too many password reset requests, please try again later');
  }
}

const VERIFY_USER_WINDOW_MS = 60 * 60_000;
export const VERIFY_USER_MAX_ATTEMPTS = 3;
const VERIFY_IP_WINDOW_MS = 60 * 60_000;
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

const USER_SEARCH_USER_WINDOW_MS = 60 * 60_000;
export const USER_SEARCH_USER_MAX_ATTEMPTS = 100;
const USER_SEARCH_IP_WINDOW_MS = 60 * 60_000;
export const USER_SEARCH_IP_MAX_ATTEMPTS = 300;

// This is the whole bound on scraping the user directory by name, so it is
// keyed by address as well as by account: an account costs a signup, and signup
// allows 50 an hour from one source, which would otherwise multiply a per-user
// budget by fifty. Sized for an as-you-type box — a debounced keystroke run is
// a handful of calls, so the user budget is tens of people added in a sitting.
export async function enforceUserSearchRateLimit(c: Context, userId: string): Promise<void> {
  const now = Date.now();
  const userAllowed = await consumeRateLimit(
    `user-search:${userId}`,
    now,
    USER_SEARCH_USER_MAX_ATTEMPTS,
    USER_SEARCH_USER_WINDOW_MS
  );
  const ipAllowed = await consumeRateLimit(
    `user-search-ip:${clientIp(c)}`,
    now,
    USER_SEARCH_IP_MAX_ATTEMPTS,
    USER_SEARCH_IP_WINDOW_MS
  );
  if (!userAllowed || !ipAllowed) {
    throw new AppError(429, 'Too many searches, please try again later');
  }
}

const INVITE_LOOKUP_WINDOW_MS = 60 * 60_000;
export const INVITE_LOOKUP_MAX_ATTEMPTS = 100;
const INVITE_SEND_WINDOW_MS = 60 * 60_000;
export const INVITE_SEND_MAX_ATTEMPTS = 20;
const INVITE_RESEND_WINDOW_MS = 60 * 60_000;
export const INVITE_RESEND_MAX_ATTEMPTS = 3;

// Metered apart from mail: this bounds how fast a share attempt can tell an
// address with an account from one without. Spent whatever the answer, so no
// reply about an address is free. Sized for onboarding a team in one sitting.
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

// Refuses every caller alike once the mail budget is gone, including those whose
// call would never have sent anything: a budget that turned away only the
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

// Spent only where mail goes out: the only path that mails an address nobody
// has proved they control.
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

// Keyed on the invitation rather than the caller: the inviter's hourly total
// does not stop one address being mailed the same link over and over, by them
// or by a second editor.
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

const AUTH_IP_WINDOW_MS = 60 * 60_000;
export const AUTH_IP_MAX_ATTEMPTS = 300;

// Spent as one set, so an attempt any of the three refuses spends none of them.
// That matters because a refusal here is answered before the handler reaches a
// password hash: charging the hourly budget for attempts that cost the server
// nothing would let one client in a retry loop — a saved password gone stale, a
// script with no backoff — exhaust a ceiling every other caller at its address
// shares.
export async function enforceAuthRateLimit(c: Context, email: string): Promise<void> {
  const address = clientIp(c);
  const normalizedEmail = email.toLowerCase();

  const refusedBy = await consumeBudgets(
    [
      { key: `ip:${address}:${normalizedEmail}`, max: MAX_ATTEMPTS, windowMs: WINDOW_MS },
      // Email-keyed but address-independent: bounds total guesses against one
      // account even when attempts arrive from many distinct source IPs.
      {
        key: `email:${normalizedEmail}`,
        max: EMAIL_MAX_ATTEMPTS,
        windowMs: EMAIL_WINDOW_MS,
      },
      // Keyed on the source alone, and the only thing bounding what one of them
      // can spend in total: both budgets above are keyed on the email the caller
      // supplies, so one that varies it every request gets a fresh counter in
      // each and neither ever refuses. Every attempt that gets past all three
      // costs an argon2 verify — an email with no account included, since login
      // verifies a dummy hash to keep its timing flat — so without this an
      // unauthenticated caller sets the pace of the most expensive operation in
      // the product.
      //
      // What that costs is CPU and queue depth, not memory: the hash holds
      // 64 MiB while it runs, but concurrency is capped by the thread pool it
      // runs on, so peak memory is the same whether attempts arrive four at a
      // time or sixty. It is that pool everything else — every fs read, every
      // zlib pass — then queues behind. Sized well above an office signing in
      // for the day and well below what keeps the pool busy.
      { key: `auth-ip:${address}`, max: AUTH_IP_MAX_ATTEMPTS, windowMs: AUTH_IP_WINDOW_MS },
    ],
    Date.now()
  );

  if (refusedBy !== null) {
    throw new AppError(429, 'Too many attempts, please try again later');
  }
}

const SIGNUP_IP_WINDOW_MS = 60 * 60_000;
export const SIGNUP_IP_MAX_ATTEMPTS = 50;

// What bounds how many accounts one source can open on addresses it does not
// own. The auth limiter it runs beside does spend a bucket keyed on the source,
// but that one is sized for password hashing and sits six times higher, so this
// is the ceiling that actually binds. It is far above a whole office signing up
// together.
export async function enforceSignupRateLimit(c: Context): Promise<void> {
  const allowed = await consumeRateLimit(
    `signup-ip:${clientIp(c)}`,
    Date.now(),
    SIGNUP_IP_MAX_ATTEMPTS,
    SIGNUP_IP_WINDOW_MS
  );
  if (!allowed) {
    throw new AppError(429, 'Too many accounts created, please try again later');
  }
}

const LINK_ATTACH_WINDOW_MS = 60 * 60_000;
export const LINK_ATTACH_MAX_ATTEMPTS = 60;

// The only user-triggered outbound request in the product: without a budget, a
// card is an unbounded request amplifier pointed at whatever host is named.
export async function enforceLinkAttachmentRateLimit(userId: string): Promise<void> {
  const allowed = await consumeRateLimit(
    `link-attach:${userId}`,
    Date.now(),
    LINK_ATTACH_MAX_ATTEMPTS,
    LINK_ATTACH_WINDOW_MS
  );
  if (!allowed) {
    throw new AppError(429, 'Too many links, please try again later');
  }
}
