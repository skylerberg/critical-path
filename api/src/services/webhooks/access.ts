import type { Kysely, Selectable } from 'kysely';
import type { DB, ProjectWebhook } from '../../db/types';
import { AppError } from '../../utils/errors';
import { assertProjectAccess, assertProjectWrite } from '../authorization';

const WEBHOOK_NOT_FOUND = 'Webhook not found';

async function loadWebhook(db: Kysely<DB>, webhookId: string): Promise<Selectable<ProjectWebhook>> {
  const webhook = await db
    .selectFrom('project_webhook')
    .selectAll()
    .where('id', '=', webhookId)
    .executeTakeFirst();
  if (!webhook) {
    throw new AppError(404, WEBHOOK_NOT_FOUND);
  }
  return webhook;
}

// No access to the webhook's project answers 404, exactly as an unknown registration
// does, so neither can be probed; a viewer of the project gets 403.
export async function assertWebhookWrite(
  db: Kysely<DB>,
  userId: string,
  webhookId: string
): Promise<Selectable<ProjectWebhook>> {
  const webhook = await loadWebhook(db, webhookId);
  await assertProjectWrite(db, userId, webhook.project_id, WEBHOOK_NOT_FOUND);
  return webhook;
}

// The delivery log is the one webhook route a viewer may reach, so this asserts
// access rather than write.
export async function assertWebhookAccess(
  db: Kysely<DB>,
  userId: string,
  webhookId: string
): Promise<Selectable<ProjectWebhook>> {
  const webhook = await loadWebhook(db, webhookId);
  await assertProjectAccess(db, userId, webhook.project_id, WEBHOOK_NOT_FOUND);
  return webhook;
}
