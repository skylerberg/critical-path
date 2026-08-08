// Which types are deliverable, and the reason each is or is not, now lives in
// the realtime event catalog: one table answers that alongside every other
// question about a type, so a new event cannot reach the bus with the webhook
// question left unanswered.
export { isWebhookEvent, WEBHOOK_EVENT_TYPES } from '../realtime/eventCatalog';

// A webhook event is a realtime envelope narrowed to the deliverable types, so
// the delivery payload cannot drift from what the socket carries for the same
// event: they are one declaration in realtime/payloads.ts.
export type { WebhookEnvelope as WebhookEvent } from '../realtime/payloads';
