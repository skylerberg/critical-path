import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { getRedis, redisConfigured } from '../services/redis';
import { logger, type LogFields } from '../utils/logger';

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

interface Budget {
  key: string;
  max: number;
}

// Deciding and spending have to be one step. Reading a counter and then raising
// it leaves everything that arrives in between reading the stale value and
// passing too, and over a network that gap is a round trip wide.
//
// Answers 0, or the 1-based position of the first full budget having spent
// nothing. Every key it looks at is given an expiry if it has none, whatever
// the verdict: a counter that lost its expiry never resets, and repairing only
// what gets spent would strand exactly the full ones, forever.
//
// Sent in full rather than by hash, because a NOSCRIPT answer after a Redis
// restart would silently drop every budget back to the per-process window.
const CONSUME_SCRIPT = `
local n = #KEYS
local refused = 0
for i = 1, n do
  redis.call('PEXPIRE', KEYS[i], ARGV[n + 1], 'NX')
  if refused == 0 and tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then
    refused = i
  end
end
if refused > 0 then
  return refused
end
for i = 1, n do
  redis.call('INCR', KEYS[i])
  redis.call('PEXPIRE', KEYS[i], ARGV[n + 1], 'NX')
end
return 0
`;

// Guarded rather than a plain DECR: on a key whose window has already expired
// that would recreate it at -1 with no expiry at all.
const REFUND_SCRIPT = `
for i = 1, #KEYS do
  if tonumber(redis.call('GET', KEYS[i]) or '0') > 0 then
    redis.call('DECR', KEYS[i])
  end
end
return 0
`;

// null means "no shared verdict" (Redis unconfigured or unreachable); the
// caller then falls back to the per-process window, which still bounds abuse
// per replica rather than failing closed on a Redis outage.
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
    // An error reply arrives as a normal completion, not a lost connection, so
    // anything that is not a position has to be refused as a verdict.
    if (typeof reply !== 'number' || reply < 0 || reply > budgets.length) {
      throw new Error(`Unreadable rate limit reply: ${JSON.stringify(reply)}`);
    }
    return reply;
  } catch (err) {
    logger.warn({
      msg: 'Shared rate limit unavailable; using per-process fallback',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function consumeBudgetsLocal(budgets: Budget[], now: number, windowMs: number): number {
  sweep(now);
  for (const [index, budget] of budgets.entries()) {
    const window = windows.get(budget.key);
    if (window !== undefined && window.resetAt > now && window.count >= budget.max) {
      return index + 1;
    }
  }
  for (const budget of budgets) {
    const window = windows.get(budget.key);
    if (window === undefined || window.resetAt <= now) {
      windows.set(budget.key, { count: 1, resetAt: now + windowMs });
    } else {
      window.count++;
    }
  }
  return 0;
}

// All or nothing, so a message one budget refuses never denies the next one
// another budget's slot.
async function consumeBudgets(
  budgets: Budget[],
  now: number,
  windowMs: number
): Promise<Budget | null> {
  const args = [...budgets.map((budget) => String(budget.max)), String(windowMs)];
  const shared = await runShared(CONSUME_SCRIPT, budgets, args);
  const refused = shared ?? consumeBudgetsLocal(budgets, now, windowMs);
  return refused === 0 ? null : budgets[refused - 1];
}

async function refundBudgets(budgets: Budget[], now: number): Promise<void> {
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
  return (await consumeBudgets([{ key, max: maxAttempts }], now, windowMs)) === null;
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

export const NOTIFY_WINDOW_MS = 60 * 60_000;
export const NOTIFY_PAIR_MAX_ATTEMPTS = 20;
export const NOTIFY_RECIPIENT_MAX_ATTEMPTS = 100;
// Distinct senders named per silenced mailbox per window. One line cannot tell
// a single loop from a farm of accounts, which is the attack the ceiling exists
// for; one line per sender is unbounded, which is the log spam it was avoiding.
export const NOTIFY_SILENCE_LOG_MAX = 10;

// An abuse loop is the high-volume case, so an unconditional line would turn a
// flood into log spam, but dropping mail with no trace at all leaves a silenced
// recipient invisible.
async function warnDropped(budgets: Budget[], fields: LogFields): Promise<void> {
  if ((await consumeBudgets(budgets, Date.now(), NOTIFY_WINDOW_MS)) === null) {
    logger.warn(fields);
  }
}

// Keyed on the pair. A budget keyed on the recipient alone is spent by whoever
// causes the write, so a stranger can exhaust it on someone else's behalf and
// silence the people that recipient actually works with; one keyed on the
// sender alone bounds nothing about what a mailbox receives. The ceiling above
// the pair only bites once many separate senders are involved. Refusal is
// silent rather than thrown, because the mutation has already committed.
export async function withNotificationBudget(
  recipientId: string,
  actorId: string,
  repeatKey: string,
  send: () => Promise<void>
): Promise<void> {
  const now = Date.now();
  const repeat: Budget = { key: `notify-repeat:${recipientId}:${repeatKey}`, max: 1 };
  const pair: Budget = {
    key: `notify-pair:${recipientId}:${actorId}`,
    max: NOTIFY_PAIR_MAX_ATTEMPTS,
  };
  const recipient: Budget = {
    key: `notify-recipient:${recipientId}`,
    max: NOTIFY_RECIPIENT_MAX_ATTEMPTS,
  };
  const budgets = [repeat, pair, recipient];

  const refusedBy = await consumeBudgets(budgets, now, NOTIFY_WINDOW_MS);
  if (refusedBy === pair) {
    await warnDropped([{ key: `notify-drop-log:pair:${recipientId}:${actorId}`, max: 1 }], {
      msg: 'Notification email dropped: one sender has spent their budget for this recipient',
      recipient_id: recipientId,
      actor_id: actorId,
    });
  } else if (refusedBy === recipient) {
    await warnDropped(
      [
        { key: `notify-drop-log:silenced:${recipientId}:${actorId}`, max: 1 },
        { key: `notify-drop-log:silenced:${recipientId}`, max: NOTIFY_SILENCE_LOG_MAX },
      ],
      {
        msg: 'Notification email dropped: this recipient is over their total budget',
        recipient_id: recipientId,
        actor_id: actorId,
      }
    );
  }
  if (refusedBy !== null) {
    return;
  }

  try {
    await send();
  } catch (err) {
    // Only the collapse slot comes back: its job is to not say the same thing
    // twice, and nothing was said. The other two bound attempts, not
    // deliveries, and an address the provider rejects every time is the case
    // they exist for — refunding those uncaps the loop that never succeeds.
    await refundBudgets([repeat], now);
    throw err;
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
