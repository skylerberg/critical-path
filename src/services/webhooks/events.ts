import type { WebhookEventType } from '../realtime/eventCatalog';

// Which types are deliverable, and the reason each is or is not, now lives in
// the realtime event catalogue: one table answers that alongside every other
// question about a type, so a new event cannot reach the bus with the webhook
// question left unanswered.
export { isWebhookEvent, WEBHOOK_EVENT_TYPES } from '../realtime/eventCatalog';

export interface WebhookEvent {
  type: WebhookEventType;
  project_id: string;
  data: unknown;
}
