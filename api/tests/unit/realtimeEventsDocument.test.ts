import { describe, it, expect } from 'vitest';
import { buildRealtimeEventsDocument } from '../../src/spec/realtime-events';
import {
  REALTIME_EVENT_TYPES,
  WEBHOOK_EVENT_TYPES,
} from '../../src/services/realtime/eventCatalog';

describe('realtime events document', () => {
  it('describes every event the catalog publishes, socket and webhook', async () => {
    const { schemas } = (await buildRealtimeEventsDocument()).components as {
      schemas: Record<string, { oneOf?: unknown[] }>;
    };

    expect(schemas.RealtimeEvent.oneOf).toHaveLength(REALTIME_EVENT_TYPES.length);
    expect(schemas.WebhookEvent.oneOf).toHaveLength(WEBHOOK_EVENT_TYPES.size);
  });

  it('pins the project id to the event scope, so a client can narrow on it', async () => {
    const { schemas } = (await buildRealtimeEventsDocument()).components as {
      schemas: Record<string, { properties: { project_id: { type: string } } }>;
    };

    expect(schemas.UserUpdatedEvent.properties.project_id.type).toBe('null');
    expect(schemas.AccountUpdatedEvent.properties.project_id.type).toBe('null');
    expect(schemas.TaskCreatedEvent.properties.project_id.type).toBe('string');
  });

  it('carries each payload into the webhook body as well as the socket envelope', async () => {
    const { schemas } = (await buildRealtimeEventsDocument()).components as {
      schemas: Record<string, { properties: Record<string, unknown> }>;
    };

    expect(schemas.TaskCreatedWebhookEvent.properties.data).toEqual(
      schemas.TaskCreatedEvent.properties.data
    );
  });
});
