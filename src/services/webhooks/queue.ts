import crypto from 'crypto';
import { sql, type Kysely, type Selectable } from 'kysely';
import { db } from '../../db/index';
import type { DB, WebhookDelivery } from '../../db/types';
import type { WebhookEvent } from './events';
import {
  BACKOFF_SECONDS,
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_ERROR_CHARS,
} from '../retryPolicy';

export { BACKOFF_SECONDS, MAX_ATTEMPTS, MAX_CONSECUTIVE_FAILURES };

export const CLAIM_BATCH = 20;
export const MAX_PER_WEBHOOK_PER_TICK = 5;
export const MAX_CONCURRENT_SENDS = 4;
export const MAX_WEBHOOKS_PER_PROJECT = 10;
export const SEND_TIMEOUT_MS = 10_000;
export const MAX_ERROR_BODY_BYTES = 2048;
const RETENTION_DAYS = 7;
// Exported for src/spec/realtime-events.ts, which pins the same version into the
// generated description of the webhook body.
export const ENVELOPE_VERSION = 1;

const INSERT_CHUNK = 500;

export type DeliveryRow = Selectable<WebhookDelivery>;

// A batch per request, not a call per event: one member removal publishes a
// task_relations_set per stripped task, which per-event would be N selects.
export async function enqueueDeliveries(events: WebhookEvent[]): Promise<void> {
  if (events.length === 0) return;

  const projectIds = [...new Set(events.map((event) => event.project_id))];
  const webhooks = await db
    .selectFrom('project_webhook')
    .select(['id', 'project_id'])
    .where('project_id', 'in', projectIds)
    .where('disabled_at', 'is', null)
    .execute();
  if (webhooks.length === 0) return;

  const byProject = new Map<string, string[]>();
  for (const webhook of webhooks) {
    const existing = byProject.get(webhook.project_id);
    if (existing) {
      existing.push(webhook.id);
    } else {
      byProject.set(webhook.project_id, [webhook.id]);
    }
  }

  const now = new Date();
  const rows = events.flatMap((event) =>
    (byProject.get(event.project_id) ?? []).map((webhookId) => {
      const id = crypto.randomUUID();
      return {
        id,
        webhook_id: webhookId,
        event_type: event.type,
        payload: JSON.stringify({
          id,
          version: ENVELOPE_VERSION,
          type: event.type,
          project_id: event.project_id,
          created_at: now.toISOString(),
          data: event.data,
        }),
        next_attempt_at: now,
      };
    })
  );
  if (rows.length === 0) return;

  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
    await db
      .insertInto('webhook_delivery')
      .values(rows.slice(offset, offset + INSERT_CHUNK))
      .execute();
  }
}

// FOR UPDATE SKIP LOCKED plus the lease is what makes two replicas safe; the
// row_number cap stops one flapping receiver from filling every batch. The
// window function has to sit a level below FOR UPDATE, which Postgres rejects
// in a select that also windows.
export async function claimDueDeliveries(limit: number): Promise<DeliveryRow[]> {
  const result = await sql<DeliveryRow>`
    update webhook_delivery d
    set attempt_count = d.attempt_count + 1,
        last_attempt_at = now(),
        next_attempt_at = now() + make_interval(secs => ${LEASE_SECONDS})
    from (
      select ranked.id
      from (
        select wd2.id,
               wd2.next_attempt_at,
               row_number() over (
                 partition by wd2.webhook_id order by wd2.next_attempt_at, wd2.id
               ) as rn
        from webhook_delivery wd2
        join project_webhook pw on pw.id = wd2.webhook_id
        where wd2.status = 'pending'
          and wd2.next_attempt_at <= now()
          and pw.disabled_at is null
      ) ranked
      join webhook_delivery wd on wd.id = ranked.id
      where ranked.rn <= ${MAX_PER_WEBHOOK_PER_TICK}
      order by ranked.next_attempt_at
      limit ${limit}
      for update of wd skip locked
    ) claimed
    where d.id = claimed.id
    returning d.*
  `.execute(db);
  return result.rows;
}

// Every writer in this module takes project_webhook before webhook_delivery, so
// two records of the same webhook cannot deadlock; keep that order.
export async function recordSuccess(delivery: DeliveryRow, statusCode: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('project_webhook')
      .set({ consecutive_failures: 0 })
      .where('id', '=', delivery.webhook_id)
      .execute();
    await trx
      .updateTable('webhook_delivery')
      .set({
        status: 'delivered',
        next_attempt_at: null,
        last_status_code: statusCode,
        last_error: null,
      })
      .where('id', '=', delivery.id)
      .execute();
  });
}

export interface FailureOutcome {
  webhookDisabled: boolean;
}

export async function recordFailure(
  delivery: DeliveryRow,
  outcome: { statusCode?: number; error: string }
): Promise<FailureOutcome> {
  const lastError = outcome.error.slice(0, MAX_ERROR_CHARS);
  const lastStatusCode = outcome.statusCode ?? null;
  // attempt_count is already post-increment: the claim bumped it.
  const exhausted = delivery.attempt_count >= MAX_ATTEMPTS;

  return db.transaction().execute(async (trx): Promise<FailureOutcome> => {
    // Locked, not just read: a row put back to pending on a webhook disabled
    // mid-send is unreachable to both the claim and the prune.
    const webhook = await trx
      .selectFrom('project_webhook')
      .select('disabled_at')
      .where('id', '=', delivery.webhook_id)
      .forUpdate()
      .executeTakeFirst();
    const active = webhook !== undefined && webhook.disabled_at === null;

    if (!exhausted && active) {
      const backoff =
        BACKOFF_SECONDS[Math.min(delivery.attempt_count - 1, BACKOFF_SECONDS.length - 1)];
      await trx
        .updateTable('webhook_delivery')
        .set({
          status: 'pending',
          next_attempt_at: sql<Date>`now() + make_interval(secs => ${sql.lit(backoff)})`,
          last_status_code: lastStatusCode,
          last_error: lastError,
        })
        .where('id', '=', delivery.id)
        .execute();
      return { webhookDisabled: false };
    }

    await trx
      .updateTable('webhook_delivery')
      .set({
        status: 'failed',
        next_attempt_at: null,
        last_status_code: lastStatusCode,
        last_error: lastError,
      })
      .where('id', '=', delivery.id)
      .execute();

    if (!active) {
      return { webhookDisabled: true };
    }

    // Resend is a human poking a receiver they already know is broken; letting
    // it drive auto-disable would turn the debugging tool into a self-destruct.
    if (delivery.redelivery_count > 0) {
      return { webhookDisabled: false };
    }

    const updated = await trx
      .updateTable('project_webhook')
      .set((eb) => ({ consecutive_failures: eb('consecutive_failures', '+', 1) }))
      .where('id', '=', delivery.webhook_id)
      .returning('consecutive_failures')
      .executeTakeFirst();
    if (updated === undefined || updated.consecutive_failures < MAX_CONSECUTIVE_FAILURES) {
      return { webhookDisabled: false };
    }

    await trx
      .updateTable('project_webhook')
      .set({ disabled_at: new Date() })
      .where('id', '=', delivery.webhook_id)
      .execute();
    await failPendingDeliveries(
      trx,
      delivery.webhook_id,
      'Webhook disabled after repeated failures'
    );
    return { webhookDisabled: true };
  });
}

// Shared by the auto-disable and manual-disable paths: a pending row left behind
// is stranded forever (the claim skips disabled webhooks and the prune keeps
// pending rows), and would flood the receiver the moment the webhook came back.
export async function failPendingDeliveries(
  connection: Kysely<DB>,
  webhookId: string,
  reason: string
): Promise<void> {
  await connection
    .updateTable('webhook_delivery')
    .set({ status: 'failed', next_attempt_at: null, last_error: reason })
    .where('webhook_id', '=', webhookId)
    .where('status', '=', 'pending')
    .execute();
}

export async function pruneDeliveries(): Promise<void> {
  await db
    .deleteFrom('webhook_delivery')
    .where('status', '!=', 'pending')
    .where('created_at', '<', sql<Date>`now() - make_interval(days => ${sql.lit(RETENTION_DAYS)})`)
    .execute();
}
