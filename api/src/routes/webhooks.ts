import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import type { Selectable } from 'kysely';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertProjectAccess, canAccessProject } from '../services/authorization';
import type { ProjectWebhook, WebhookDelivery } from '../db/types';
import {
  MAX_WEBHOOKS_PER_PROJECT,
  assertRegistrableWebhookUrl,
  failPendingDeliveries,
  generateWebhookSecret,
  targetPolicy,
} from '../services/webhooks/index';
import {
  createWebhookSchema,
  patchWebhookSchema,
  webhooksQuerySchema,
  webhookDeliveriesQuerySchema,
  webhookDeliveryParamsSchema,
  webhookSchema,
  webhooksListResponseSchema,
  webhookDeliveriesResponseSchema,
  type WebhookResponse,
  type WebhookDeliveryResponse,
  idSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const DEFAULT_DELIVERY_LIMIT = 20;

function toWebhookResponse(row: Selectable<ProjectWebhook>): WebhookResponse {
  return {
    id: row.id,
    project_id: row.project_id,
    url: row.url,
    secret: row.secret,
    disabled_at: row.disabled_at?.toISOString() ?? null,
    consecutive_failures: row.consecutive_failures,
    created_at: row.created_at.toISOString(),
  };
}

function toDeliveryResponse(row: Selectable<WebhookDelivery>): WebhookDeliveryResponse {
  return {
    id: row.id,
    webhook_id: row.webhook_id,
    event_type: row.event_type,
    status: row.status,
    attempt_count: row.attempt_count,
    redelivery_count: row.redelivery_count,
    last_status_code: row.last_status_code,
    last_error: row.last_error,
    next_attempt_at: row.next_attempt_at?.toISOString() ?? null,
    last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    payload: row.payload,
  };
}

const router: AppHono = new Hono();

router.post(
  '/',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Register webhook',
    description:
      'Register an HTTP(S) endpoint that receives a signed POST for every board event in a ' +
      `project. The client supplies the webhook id. A project may hold at most ${String(MAX_WEBHOOKS_PER_PROJECT)} ` +
      'registrations, and a URL may be registered once per project. The generated signing ' +
      'secret is in the response and stays readable by everyone who can access the project. ' +
      'Returns 404 when the project is unknown or inaccessible.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Webhook registered',
        content: { 'application/json': { schema: resolver(webhookSchema) } },
      },
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(createWebhookSchema),
  async (c) => {
    const { id, project_id, url } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    // Locked for the rest of the transaction: the per-project cap below has no
    // constraint behind it, so two concurrent registrations would both read a
    // pre-cap count and both insert.
    const project = await db
      .selectFrom('project')
      .select(['id', 'created_by'])
      .where('id', '=', project_id)
      .forUpdate()
      .executeTakeFirst();
    if (!project || !(await canAccessProject(db, user.id, project))) {
      throw new AppError(404, 'Project not found');
    }

    assertRegistrableWebhookUrl(url, targetPolicy());

    const { count } = await db
      .selectFrom('project_webhook')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('project_webhook.project_id', '=', project_id)
      .executeTakeFirstOrThrow();
    if (Number(count) >= MAX_WEBHOOKS_PER_PROJECT) {
      throw new AppError(
        422,
        `Project already has the maximum of ${String(MAX_WEBHOOKS_PER_PROJECT)} webhooks`
      );
    }

    try {
      const row = await db
        .insertInto('project_webhook')
        .values({ id, project_id, url, secret: generateWebhookSecret() })
        .returningAll()
        .executeTakeFirstOrThrow();
      return c.json(toWebhookResponse(row), 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Webhook id or URL already registered for this project');
      }
      throw err;
    }
  }
);

router.get(
  '/',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'List webhooks',
    description:
      "List a project's webhook registrations, oldest first, including their signing secrets.",
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Webhook registrations',
        content: { 'application/json': { schema: resolver(webhooksListResponseSchema) } },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  queryValidator(webhooksQuerySchema),
  async (c) => {
    const { project_id } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectAccess(db, user.id, project_id);

    const rows = await db
      .selectFrom('project_webhook')
      .selectAll()
      .where('project_webhook.project_id', '=', project_id)
      .orderBy('project_webhook.created_at')
      .orderBy('project_webhook.id')
      .execute();
    return c.json({ webhooks: rows.map(toWebhookResponse) }, 200);
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Update webhook',
    description:
      'Change the target URL, or disable and re-enable a registration. Sending a timestamp for ' +
      '`disabled_at` stops delivery and terminates every queued delivery for that webhook; ' +
      'sending null re-enables it and clears its consecutive failure count.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated webhook',
        content: { 'application/json': { schema: resolver(webhookSchema) } },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(patchWebhookSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const existing = await db
      .selectFrom('project_webhook')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) {
      throw new AppError(404, 'Webhook not found');
    }
    await assertProjectAccess(db, user.id, existing.project_id, 'Webhook not found');

    const updates: { url?: string; disabled_at?: Date | null; consecutive_failures?: number } = {};
    if (body.url !== undefined) {
      assertRegistrableWebhookUrl(body.url, targetPolicy());
      updates.url = body.url;
    }
    if (body.disabled_at !== undefined) {
      if (body.disabled_at === null) {
        updates.disabled_at = null;
        // A re-enabled webhook would otherwise auto-disable on its first failure
        // — but only on the transition, or a client that resubmits the whole
        // record on every patch would keep a dead endpoint alive forever.
        if (existing.disabled_at !== null) {
          updates.consecutive_failures = 0;
        }
      } else {
        updates.disabled_at = new Date(body.disabled_at);
      }
    }

    if (Object.keys(updates).length === 0) {
      return c.json(toWebhookResponse(existing), 200);
    }

    let row: Selectable<ProjectWebhook> | undefined;
    try {
      row = await db
        .updateTable('project_webhook')
        .set(updates)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'That URL is already registered for this project');
      }
      throw err;
    }
    if (!row) {
      throw new AppError(404, 'Webhook not found');
    }

    if (row.disabled_at !== null) {
      await failPendingDeliveries(db, id, 'Webhook disabled');
    }
    return c.json(toWebhookResponse(row), 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Delete webhook',
    description: 'Delete a registration. Its delivery log goes with it by cascade.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Webhook deleted' },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const webhook = await db
      .selectFrom('project_webhook')
      .select(['id', 'project_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!webhook) {
      throw new AppError(404, 'Webhook not found');
    }
    await assertProjectAccess(db, user.id, webhook.project_id, 'Webhook not found');

    await db.deleteFrom('project_webhook').where('id', '=', id).execute();
    return c.body(null, 204);
  }
);

router.post(
  '/:id/rotate-secret',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Rotate webhook secret',
    description:
      'Replace the signing secret. A delivery a worker has already claimed signs with the ' +
      'secret it read, so a receiver should accept the previous secret briefly after rotating ' +
      'or tolerate one rejected delivery, which then retries under the new secret.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Webhook with its new secret',
        content: { 'application/json': { schema: resolver(webhookSchema) } },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const webhook = await db
      .selectFrom('project_webhook')
      .select(['id', 'project_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!webhook) {
      throw new AppError(404, 'Webhook not found');
    }
    await assertProjectAccess(db, user.id, webhook.project_id, 'Webhook not found');

    const row = await db
      .updateTable('project_webhook')
      .set({ secret: generateWebhookSecret() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(toWebhookResponse(row), 200);
  }
);

router.get(
  '/:id/deliveries',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'List webhook deliveries',
    description:
      'The delivery log for one registration, newest first, with the sent envelope, the ' +
      'response code and the last error. Terminal entries are kept for seven days.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Delivery log',
        content: { 'application/json': { schema: resolver(webhookDeliveriesResponseSchema) } },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  queryValidator(webhookDeliveriesQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { limit } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    const webhook = await db
      .selectFrom('project_webhook')
      .select(['id', 'project_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!webhook) {
      throw new AppError(404, 'Webhook not found');
    }
    await assertProjectAccess(db, user.id, webhook.project_id, 'Webhook not found');

    const rows = await db
      .selectFrom('webhook_delivery')
      .selectAll()
      .where('webhook_delivery.webhook_id', '=', id)
      .orderBy('webhook_delivery.created_at', 'desc')
      .orderBy('webhook_delivery.id', 'desc')
      .limit(limit ?? DEFAULT_DELIVERY_LIMIT)
      .execute();
    return c.json({ deliveries: rows.map(toDeliveryResponse) }, 200);
  }
);

router.post(
  '/:id/deliveries/:deliveryId/redeliver',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Re-send a failed delivery',
    description:
      'Queue a failed delivery for a fresh retry cycle. The delivery id, and therefore the ' +
      'envelope id and the X-Critical-Path-Delivery header, are unchanged, so a receiver ' +
      'idempotency key still matches. Re-sent deliveries never count toward auto-disable.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: { description: 'Delivery queued for another attempt' },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(webhookDeliveryParamsSchema),
  async (c) => {
    const { id, deliveryId } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const webhook = await db
      .selectFrom('project_webhook')
      .select(['id', 'project_id', 'disabled_at'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!webhook) {
      throw new AppError(404, 'Webhook not found');
    }
    await assertProjectAccess(db, user.id, webhook.project_id, 'Webhook not found');

    const delivery = await db
      .selectFrom('webhook_delivery')
      .select(['id', 'status'])
      .where('webhook_delivery.id', '=', deliveryId)
      .where('webhook_delivery.webhook_id', '=', id)
      .executeTakeFirst();
    if (!delivery) {
      throw new AppError(404, 'Delivery not found');
    }
    if (webhook.disabled_at !== null) {
      throw new AppError(409, 'Webhook is disabled');
    }
    if (delivery.status !== 'failed') {
      throw new AppError(409, 'Only a failed delivery can be re-sent');
    }

    // A fresh cycle, not one more attempt: leaving attempt_count at its
    // exhausted value would buy a single retry and immediately go terminal.
    await db
      .updateTable('webhook_delivery')
      .set((eb) => ({
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: new Date(),
        last_error: null,
        last_status_code: null,
        redelivery_count: eb('redelivery_count', '+', 1),
      }))
      .where('id', '=', deliveryId)
      .execute();
    return c.body(null, 204);
  }
);

export default router;
