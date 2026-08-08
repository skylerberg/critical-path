import { toOpenAPISchema } from '@standard-community/standard-openapi';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { ENVELOPE_VERSION } from '../webhooks/queue';
import { REALTIME_EVENT_TYPES, eventScope, isWebhookEvent } from './eventCatalog';
import type { RealtimeEventType } from './eventCatalog';
import { REALTIME_PAYLOAD_SCHEMAS } from './payloads';

// `/ws` carries no HTTP request or response, so none of this can live in
// openapi.json — and the web app's generator prunes any component schema no path
// reaches, so parking it there would not survive codegen either. This builds a
// second, standalone document describing the socket and webhook envelopes, which
// the clients generate their event types from exactly as they generate their API
// client from openapi.json.

// Mirrors the fallback in utils/schema-registry.ts: ArkType throws converting
// any schema built with `.pipe(...)` without it.
const TO_OPENAPI_OPTS = {
  options: { fallback: (ctx: { base: unknown }) => ctx.base },
} as const;

function eventSchemaName(type: RealtimeEventType, suffix: string): string {
  const pascal = type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
  return `${pascal}${suffix}`;
}

async function payloadSchema(type: RealtimeEventType): Promise<unknown> {
  const schema = REALTIME_PAYLOAD_SCHEMAS[type] as unknown as StandardSchemaV1;
  return (await toOpenAPISchema(schema, TO_OPENAPI_OPTS)).schema;
}

export async function buildRealtimeEventsDocument(): Promise<Record<string, unknown>> {
  const schemas: Record<string, unknown> = {};
  const socketRefs: { $ref: string }[] = [];
  const webhookRefs: { $ref: string }[] = [];

  for (const type of [...REALTIME_EVENT_TYPES].sort()) {
    const data = await payloadSchema(type);
    const accountScoped = eventScope(type) === 'account';

    const socketName = eventSchemaName(type, 'Event');
    schemas[socketName] = {
      type: 'object',
      properties: {
        type: { type: 'string', const: type },
        project_id: accountScoped ? { type: 'null' } : { type: 'string' },
        data,
      },
      required: ['type', 'project_id', 'data'],
      additionalProperties: false,
    };
    socketRefs.push({ $ref: `#/components/schemas/${socketName}` });

    if (!isWebhookEvent(type)) continue;
    const webhookName = eventSchemaName(type, 'WebhookEvent');
    schemas[webhookName] = {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Delivery id, unique per receiver per event' },
        version: { type: 'integer', const: ENVELOPE_VERSION },
        type: { type: 'string', const: type },
        project_id: { type: 'string' },
        created_at: { type: 'string', format: 'date-time' },
        data,
      },
      required: ['id', 'version', 'type', 'project_id', 'created_at', 'data'],
      additionalProperties: false,
    };
    webhookRefs.push({ $ref: `#/components/schemas/${webhookName}` });
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Critical Path realtime and webhook events',
      version: String(ENVELOPE_VERSION),
      description:
        'Generated from src/services/realtime/payloads.ts by `npm run realtime:dump`. ' +
        'RealtimeEvent is the envelope a /ws socket receives; WebhookEvent is the body ' +
        'POSTed to a project webhook registration. Not an HTTP API: it declares no paths.',
    },
    paths: {},
    components: {
      schemas: {
        RealtimeEvent: { oneOf: socketRefs },
        WebhookEvent: { oneOf: webhookRefs },
        ...schemas,
      },
    },
  };
}
