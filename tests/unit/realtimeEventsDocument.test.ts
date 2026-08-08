import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { buildRealtimeEventsDocument } from '../../src/services/realtime/document';
import {
  REALTIME_EVENT_TYPES,
  WEBHOOK_EVENT_TYPES,
} from '../../src/services/realtime/eventCatalog';

function committedDocument(): Record<string, unknown> {
  const raw = readFileSync(new URL('../../realtime-events.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('realtime events document', () => {
  // The clients generate their event types from the committed file, not from the
  // schemas, so a payload edited without a re-dump ships a client that still
  // believes the old shape — which is the exact failure the payload map exists
  // to make impossible.
  it('matches the committed realtime-events.json', async () => {
    expect(await buildRealtimeEventsDocument()).toEqual(committedDocument());
  });

  it('describes every event the catalogue publishes, socket and webhook', async () => {
    const schemas = (await buildRealtimeEventsDocument()).components as {
      schemas: Record<string, { oneOf?: unknown[] }>;
    };

    expect(schemas.schemas.RealtimeEvent.oneOf).toHaveLength(REALTIME_EVENT_TYPES.length);
    expect(schemas.schemas.WebhookEvent.oneOf).toHaveLength(WEBHOOK_EVENT_TYPES.size);
  });

  it('pins the project id to the event scope, so a client can narrow on it', async () => {
    const { schemas } = (await buildRealtimeEventsDocument()).components as {
      schemas: Record<string, { properties: { project_id: { type: string } } }>;
    };

    expect(schemas.UserUpdatedEvent.properties.project_id.type).toBe('null');
    expect(schemas.AccountUpdatedEvent.properties.project_id.type).toBe('null');
    expect(schemas.TaskCreatedEvent.properties.project_id.type).toBe('string');
  });
});
