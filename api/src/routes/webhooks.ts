import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import type { Selectable } from 'kysely';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertCanWriteProject, assertProjectAccess, projectRole } from '../services/authorization';
import { assertWebhookAccess, assertWebhookWrite } from '../services/webhooks/access';
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
  jsonResponse,
  emptyResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const DEFAULT_DELIVERY_LIMIT = 20;

// The secret is what proves a delivery came from here, so anyone holding it can
// forge one. Every other route returning this shape is editor-only; the list is
// the one a viewer can reach.
function toWebhookResponse(row: Selectable<ProjectWebhook>, includeSecret = true): WebhookResponse {
  return {
    id: row.id,
    project_id: row.project_id,
    url: row.url,
    ...(includeSecret ? { secret: row.secret } : {}),
    disabled_at: row.disabled_at?.toISOString() ?? null,
    consecutive_failures: row.consecutive_failures,
    created_at: row.created_at.toISOString(),
  };
}

// Fail closed: the column is plain text, so a value the queue never writes is
// reported as the terminal state it already is — the claim only ever takes rows
// whose status is exactly 'pending', so nothing else is still going anywhere.
function narrowDeliveryStatus(status: string): WebhookDeliveryResponse['status'] {
  return status === 'pending' || status === 'delivered' ? status : 'failed';
}

function toDeliveryResponse(row: Selectable<WebhookDelivery>): WebhookDeliveryResponse {
  return {
    id: row.id,
    webhook_id: row.webhook_id,
    event_type: row.event_type,
    status: narrowDeliveryStatus(row.status),
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

const createWebhookResponses = { 201: jsonResponse('Webhook registered', webhookSchema) };

router.post(
  '/',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Register webhook',
    description:
      'Register an HTTP(S) endpoint that receives a signed POST for every board event in a ' +
      `project. The client supplies the webhook id. A project may hold at most ${String(MAX_WEBHOOKS_PER_PROJECT)} ` +
      'registrations, and a URL may be registered once per project. The generated signing ' +
      'secret is in the response and stays readable by editors of that project; a viewer ' +
      'listing registrations never receives it, since holding it is enough to forge a ' +
      'delivery. Registering, changing, deleting, rotating and re-sending are editors ' +
      'only: a viewer gets 403. Returns 404 when the project is unknown or inaccessible.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createWebhookResponses,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createWebhookSchema),
  async (c): Promise<Returned<typeof createWebhookResponses>> => {
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
    if (!project) {
      throw new AppError(404, 'Project not found');
    }
    await assertCanWriteProject(db, user.id, project);

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

const listWebhooksResponses = {
  200: jsonResponse('Webhook registrations', webhooksListResponseSchema),
};

router.get(
  '/',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'List webhooks',
    description:
      "List a project's webhook registrations, oldest first. Each carries its signing secret " +
      'for an editor; the secret is omitted for a viewer.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...listWebhooksResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(webhooksQuerySchema),
  async (c): Promise<Returned<typeof listWebhooksResponses>> => {
    const { project_id } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectAccess(db, user.id, project_id);
    const isEditor = (await projectRole(db, user.id, project)) === 'editor';

    const rows = await db
      .selectFrom('project_webhook')
      .selectAll()
      .where('project_webhook.project_id', '=', project_id)
      .orderBy('project_webhook.created_at')
      .orderBy('project_webhook.id')
      .execute();
    return c.json({ webhooks: rows.map((row) => toWebhookResponse(row, isEditor)) }, 200);
  }
);

const patchWebhookResponses = { 200: jsonResponse('Updated webhook', webhookSchema) };

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
      ...patchWebhookResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchWebhookSchema),
  async (c): Promise<Returned<typeof patchWebhookResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const existing = await assertWebhookWrite(db, user.id, id);

    const updates: { url?: string; disabled_at?: Date | null; consecutive_failures?: number } = {};
    if (body.url !== undefined) {
      assertRegistrableWebhookUrl(body.url, targetPolicy());
      updates.url = body.url;
    }
    if (body.disabled_at !== undefined) {
      if (body.disabled_at === null) {
        updates.disabled_at = null;
        // A re-enabled webhook would otherwise auto-disable on its first
        // failure — but only on the transition, or a client resubmitting the
        // whole record on every patch would keep a dead endpoint alive forever.
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

const deleteWebhookResponses = { 204: emptyResponse('Webhook deleted') };

router.delete(
  '/:id',
  describeRoute({
    tags: ['Webhooks'],
    summary: 'Delete webhook',
    description: 'Delete a registration. Its delivery log goes with it by cascade.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...deleteWebhookResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteWebhookResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    await assertWebhookWrite(db, user.id, id);

    await db.deleteFrom('project_webhook').where('id', '=', id).execute();
    return c.body(null, 204);
  }
);

const rotateWebhookSecretResponses = {
  200: jsonResponse('Webhook with its new secret', webhookSchema),
};

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
      ...rotateWebhookSecretResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof rotateWebhookSecretResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    await assertWebhookWrite(db, user.id, id);

    const row = await db
      .updateTable('project_webhook')
      .set({ secret: generateWebhookSecret() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return c.json(toWebhookResponse(row), 200);
  }
);

const listWebhookDeliveriesResponses = {
  200: jsonResponse('Delivery log', webhookDeliveriesResponseSchema),
};

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
      ...listWebhookDeliveriesResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  queryValidator(webhookDeliveriesQuerySchema),
  async (c): Promise<Returned<typeof listWebhookDeliveriesResponses>> => {
    const { id } = c.req.valid('param');
    const { limit } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    await assertWebhookAccess(db, user.id, id);

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

const redeliverWebhookDeliveryResponses = {
  204: emptyResponse('Delivery queued for another attempt'),
};

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
      ...redeliverWebhookDeliveryResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(webhookDeliveryParamsSchema),
  async (c): Promise<Returned<typeof redeliverWebhookDeliveryResponses>> => {
    const { id, deliveryId } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const webhook = await assertWebhookWrite(db, user.id, id);

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
