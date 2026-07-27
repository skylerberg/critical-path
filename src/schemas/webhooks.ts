import { type } from 'arktype';
import { uuid, stringWithLength, isoDateString } from './common';

// Module-local so it never enters the OpenAPI schema-name registry.
const intFromQuery = (min: number, max: number) =>
  type('string').pipe((s, ctx) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < min || n > max) {
      return ctx.error(`must be an integer between ${min} and ${max}`);
    }
    return n;
  });

export const createWebhookSchema = type({
  id: uuid,
  project_id: uuid,
  url: stringWithLength(1, 2000),
});

export const patchWebhookSchema = type({
  'url?': stringWithLength(1, 2000),
  'disabled_at?': isoDateString.or('null'),
});

export const webhooksQuerySchema = type({
  project_id: uuid,
});

export const webhookDeliveriesQuerySchema = type({
  'limit?': intFromQuery(1, 50),
});

export const webhookDeliveryParamsSchema = type({
  id: uuid,
  deliveryId: uuid,
});

export const webhookSchema = type({
  id: 'string',
  project_id: 'string',
  url: 'string',
  secret: 'string',
  disabled_at: 'string | null',
  consecutive_failures: 'number',
  created_at: 'string',
});

export const webhooksListResponseSchema = type({
  webhooks: webhookSchema.array(),
});

// `unknown` rather than `object`: arktype emits `{}` for it, which the web
// generator turns into `unknown`, where `object` becomes an unusable
// Record<string, never>. The envelope's real shape varies by event type.
export const webhookDeliverySchema = type({
  id: 'string',
  webhook_id: 'string',
  event_type: 'string',
  status: 'string',
  attempt_count: 'number',
  redelivery_count: 'number',
  last_status_code: 'number | null',
  last_error: 'string | null',
  next_attempt_at: 'string | null',
  last_attempt_at: 'string | null',
  created_at: 'string',
  payload: 'unknown',
});

export const webhookDeliveriesResponseSchema = type({
  deliveries: webhookDeliverySchema.array(),
});

export type WebhookResponse = typeof webhookSchema.infer;
export type WebhookDeliveryResponse = typeof webhookDeliverySchema.infer;
