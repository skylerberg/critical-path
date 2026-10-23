import { consumeBudgets, refundBudgets, type Budget } from './rateLimit';
import { logger, type LogFields } from '../utils/logger';

// How much mail one person's actions may cause another person to receive. The
// budgets come from ./rateLimit, but the policy here is the notification
// domain's: nothing refuses a request, and a mutation that trips a ceiling has
// already committed by the time this runs.

export const NOTIFY_WINDOW_MS = 60 * 60_000;
export const NOTIFY_PAIR_MAX_ATTEMPTS = 20;
export const NOTIFY_RECIPIENT_MAX_ATTEMPTS = 100;
// How many distinct senders may be named per silenced mailbox per window. One log
// line cannot tell a single loop from a farm of accounts, which is the attack the
// ceiling exists for; one line per sender is the log spam it avoids.
export const NOTIFY_SILENCE_LOG_MAX = 10;

// Log at most once per budget: an unconditional line turns an abuse loop into log
// spam, while dropping mail with no trace leaves a silenced recipient invisible.
async function warnDropped(budgets: Budget[], fields: LogFields): Promise<void> {
  if ((await consumeBudgets(budgets, Date.now())) === null) {
    logger.warn(fields);
  }
}

// Keyed on the pair: keyed on the recipient alone, a stranger could exhaust it on
// someone else's behalf and silence the people that recipient works with; keyed
// on the sender alone it bounds nothing about what a mailbox receives. The
// recipient's own ceiling only bites once many separate senders are involved.
// Refusal is silent rather than thrown: the mutation has already committed.
export async function withNotificationBudget(
  recipientId: string,
  actorId: string,
  repeatKey: string,
  send: () => Promise<void>
): Promise<void> {
  const now = Date.now();
  const repeat: Budget = {
    key: `notify-repeat:${recipientId}:${repeatKey}`,
    max: 1,
    windowMs: NOTIFY_WINDOW_MS,
  };
  const pair: Budget = {
    key: `notify-pair:${recipientId}:${actorId}`,
    max: NOTIFY_PAIR_MAX_ATTEMPTS,
    windowMs: NOTIFY_WINDOW_MS,
  };
  const recipient: Budget = {
    key: `notify-recipient:${recipientId}`,
    max: NOTIFY_RECIPIENT_MAX_ATTEMPTS,
    windowMs: NOTIFY_WINDOW_MS,
  };
  const budgets = [repeat, pair, recipient];

  const refusedBy = await consumeBudgets(budgets, now);
  if (refusedBy === pair) {
    await warnDropped(
      [
        {
          key: `notify-drop-log:pair:${recipientId}:${actorId}`,
          max: 1,
          windowMs: NOTIFY_WINDOW_MS,
        },
      ],
      {
        msg: 'Notification email dropped: one sender has spent their budget for this recipient',
        recipient_id: recipientId,
        actor_id: actorId,
      }
    );
  } else if (refusedBy === recipient) {
    await warnDropped(
      [
        {
          key: `notify-drop-log:silenced:${recipientId}:${actorId}`,
          max: 1,
          windowMs: NOTIFY_WINDOW_MS,
        },
        {
          key: `notify-drop-log:silenced:${recipientId}`,
          max: NOTIFY_SILENCE_LOG_MAX,
          windowMs: NOTIFY_WINDOW_MS,
        },
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
    // Only the repeat slot is refunded: its job is to not say the same thing
    // twice, and nothing was said. The other two bound attempts rather than
    // deliveries, and refunding them uncaps a loop whose sends never succeed.
    await refundBudgets([repeat], now);
    throw err;
  }
}
