import { consumeBudgets, refundBudgets, type Budget } from './rateLimit';
import { logger, type LogFields } from '../utils/logger';

// How much mail one person's actions may cause another person to receive. The
// counters are the ones ./rateLimit hands the request path, but the policy is the
// notification domain's: nothing here refuses a request, and the mutation that
// trips a ceiling has already committed by the time this runs.

export const NOTIFY_WINDOW_MS = 60 * 60_000;
export const NOTIFY_PAIR_MAX_ATTEMPTS = 20;
export const NOTIFY_RECIPIENT_MAX_ATTEMPTS = 100;
// Distinct senders named per silenced mailbox per window. A single dropped-mail
// line cannot tell one runaway loop from a farm of accounts — the case the
// recipient ceiling exists for — while a line per sender is the log spam the
// silence was avoiding.
export const NOTIFY_SILENCE_LOG_MAX = 10;

// Logs a drop as often as its `budgets` allow: an unconditional line would turn
// an abuse loop into log spam, but dropping mail with no trace leaves a silenced
// recipient invisible.
async function warnDropped(budgets: Budget[], fields: LogFields): Promise<void> {
  if ((await consumeBudgets(budgets, Date.now())) === null) {
    logger.warn(fields);
  }
}

// Both caps are keyed on the (recipient, sender) pair. Keyed on the recipient
// alone, a stranger could exhaust it on someone else's behalf and silence the
// people that recipient works with; keyed on the sender alone, it bounds nothing
// about what a mailbox receives. The recipient-wide ceiling above the pair only
// bites once many separate senders are involved. Refusal is silent rather than
// thrown — the mutation has already committed.
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
    // Only the collapse slot is refunded: its job is to avoid saying the same
    // thing twice, and nothing was said. The other two bound attempts rather than
    // deliveries, and refunding them would uncap a loop whose sends never succeed.
    await refundBudgets([repeat], now);
    throw err;
  }
}
