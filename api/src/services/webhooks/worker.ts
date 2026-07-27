import { db } from '../../db/index';
import { logger } from '../../utils/logger';
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

export async function runDueDeliveries(options: RunDueDeliveriesOptions = {}): Promise<number> {
  const claimed = await claimDueDeliveries(CLAIM_BATCH);
  if (claimed.length === 0) return 0;

  const policy = options.policy ?? targetPolicy();
  const webhookIds = [...new Set(claimed.map((row) => row.webhook_id))];
  const webhooks = await db
    .selectFrom('project_webhook')
    .select(['id', 'url', 'secret'])
    .where('id', 'in', webhookIds)
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
          await deliverOne(delivery, webhook, policy, options.resolve);
        }
      }
    }
  );
  await Promise.all(runners);
  return claimed.length;
}

async function deliverOne(
  delivery: DeliveryRow,
  webhook: { id: string; url: string; secret: string },
  policy: TargetPolicy,
  resolve: LookupAll | undefined
): Promise<void> {
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
    } else {
      await recordFailure(delivery, {
        statusCode: result.statusCode,
        error: result.error ?? 'Delivery failed',
      });
    }
  } catch (err) {
    logger.error({
      msg: 'Webhook delivery failed to record',
      delivery_id: delivery.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function startWebhookWorker(): { close: () => void } {
  let running = false;
  let ticks = 0;

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    ticks += 1;
    const shouldPrune = ticks % PRUNE_EVERY_TICKS === 0;
    void (async () => {
      try {
        await runDueDeliveries();
        if (shouldPrune) {
          await pruneDeliveries();
        }
      } catch (err) {
        logger.error({
          msg: 'Webhook worker tick failed',
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        running = false;
      }
    })();
  }, TICK_MS);
  timer.unref();

  return {
    close: () => clearInterval(timer),
  };
}
