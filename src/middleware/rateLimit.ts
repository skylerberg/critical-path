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

// Answers 0, or the 1-based position of the first full budget, having spent
// nothing. One script rather than GET-then-INCR: over a network that gap is a
// round trip wide. Every key gets an expiry if it has none, whatever the
// verdict — one that lost its expiry never resets, and repairing only what gets
// spent would strand exactly the full ones. Sent in full rather than by hash: a
// NOSCRIPT reply after a Redis restart would silently drop every budget back to
// the per-process window.
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

// All or nothing, so a message one budget refuses never spends another's slot.
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

export const INVITE_LOOKUP_WINDOW_MS = 60 * 60_000;
export const INVITE_LOOKUP_MAX_ATTEMPTS = 100;
export const INVITE_SEND_WINDOW_MS = 60 * 60_000;
export const INVITE_SEND_MAX_ATTEMPTS = 20;
export const INVITE_RESEND_WINDOW_MS = 60 * 60_000;
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

export const NOTIFY_WINDOW_MS = 60 * 60_000;
export const NOTIFY_PAIR_MAX_ATTEMPTS = 20;
export const NOTIFY_RECIPIENT_MAX_ATTEMPTS = 100;
// Distinct senders named per silenced mailbox per window. One line cannot tell a
// single loop from a farm of accounts, which is the attack the ceiling exists
// for; one line per sender is the log spam it was avoiding.
export const NOTIFY_SILENCE_LOG_MAX = 10;

// An unconditional line would turn an abuse loop into log spam, but dropping
// mail with no trace leaves a silenced recipient invisible.
async function warnDropped(budgets: Budget[], fields: LogFields): Promise<void> {
  if ((await consumeBudgets(budgets, Date.now(), NOTIFY_WINDOW_MS)) === null) {
    logger.warn(fields);
  }
}

// Keyed on the pair: keyed on the recipient alone, a stranger could exhaust it
// on someone else's behalf and silence the people that recipient works with;
// keyed on the sender alone it bounds nothing about what a mailbox receives. The
// ceiling above the pair only bites once many separate senders are involved.
// Refusal is silent rather than thrown — the mutation has already committed.
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
    // twice, and nothing was said. The other two bound attempts, not deliveries,
    // and refunding those uncaps a loop whose sends never succeed.
    await refundBudgets([repeat], now);
    throw err;
  }
}

export async function enforceAuthRateLimit(c: Context, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const ipAllowed = await consumeRateLimit(`ip:${clientIp(c)}:${normalizedEmail}`);
  // IP-independent dimension: bounds total guesses against one account even
  // when attempts arrive from many distinct source IPs.
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

export const SIGNUP_IP_WINDOW_MS = 60 * 60_000;
export const SIGNUP_IP_MAX_ATTEMPTS = 50;

// The only bound on how many accounts one source can open on addresses it does
// not own: the buckets signup already spends are keyed on the address, so a
// fresh one costs an attacker nothing. The ceiling sits far above a whole office
// signing up together.
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

export const LINK_ATTACH_WINDOW_MS = 60 * 60_000;
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
