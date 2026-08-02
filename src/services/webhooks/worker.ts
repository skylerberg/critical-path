import { db } from '../../db/index';
import { logger } from '../../utils/logger';
import { startWorker } from '../worker';
import {
  CLAIM_BATCH,
  MAX_CONCURRENT_SENDS,
  claimDueDeliveries,
  pruneDeliveries,
  recordFailure,
  recordSuccess,
  type DeliveryRow,
} from './queue';
import { sendDelivery } from './sender';
import { targetPolicy, type LookupAll, type TargetPolicy } from './targets';

export interface RunDueDeliveriesOptions {
  policy?: TargetPolicy;
  resolve?: LookupAll;
}

const TICK_MS = 5000;
const PRUNE_EVERY_TICKS = 120;
const TICK_BUDGET_MS = 120_000;

export async function runDueDeliveries(options: RunDueDeliveriesOptions = {}): Promise<number> {
  const claimed = await claimDueDeliveries(CLAIM_BATCH);
  if (claimed.length === 0) return 0;

  const policy = options.policy ?? targetPolicy();
  const webhookIds = [...new Set(claimed.map((row) => row.webhook_id))];
  // Disabled since the claim means the disable path has already terminated
  // these rows; sending them would resurrect a backlog on a dead receiver.
  const webhooks = await db
    .selectFrom('project_webhook')
    .select(['id', 'url', 'secret'])
    .where('id', 'in', webhookIds)
    .where('disabled_at', 'is', null)
    .execute();
  const byId = new Map(webhooks.map((webhook) => [webhook.id, webhook]));

  const groups = webhookIds.map((webhookId) =>
    claimed
      .filter((row) => row.webhook_id === webhookId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
  );

  let cursor = 0;
  // Sequential within a webhook so one receiver is never hit in parallel;
  // bounded across webhooks so a slow receiver cannot block every other project
  // and a burst cannot starve the pg pool the request path shares.
  const runners = Array.from(
    { length: Math.min(MAX_CONCURRENT_SENDS, groups.length) },
    async () => {
      for (;;) {
        const group = groups[cursor++];
        if (group === undefined) return;
        const webhook = byId.get(group[0].webhook_id);
        if (webhook === undefined) continue;
        for (const delivery of group) {
          if (await deliverOne(delivery, webhook, policy, options.resolve)) break;
        }
      }
    }
  );
  await Promise.all(runners);
  return claimed.length;
}

// True means the webhook is no longer active: the caller drops the rest of its
// group rather than POST to an endpoint just declared dead.
async function deliverOne(
  delivery: DeliveryRow,
  webhook: { id: string; url: string; secret: string },
  policy: TargetPolicy,
  resolve: LookupAll | undefined
): Promise<boolean> {
  try {
    const result = await sendDelivery({
      url: webhook.url,
      secret: webhook.secret,
      webhookId: webhook.id,
      delivery,
      policy,
      resolve,
    });
    if (result.ok) {
      await recordSuccess(delivery, result.statusCode ?? 0);
      return false;
    }
    const { webhookDisabled } = await recordFailure(delivery, {
      statusCode: result.statusCode,
      error: result.error ?? 'Delivery failed',
    });
    return webhookDisabled;
  } catch (err) {
    logger.error({
      msg: 'Webhook delivery failed to record',
      delivery_id: delivery.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function startWebhookWorker(): { close: () => void } {
  let ticks = 0;

  return startWorker({
    name: 'Webhook',
    tickMs: TICK_MS,
    budgetMs: TICK_BUDGET_MS,
    tick: async () => {
      ticks += 1;
      await runDueDeliveries();
      if (ticks % PRUNE_EVERY_TICKS === 0) {
        await pruneDeliveries();
      }
    },
  });
}
