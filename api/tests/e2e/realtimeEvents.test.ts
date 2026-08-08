import { describe, it, expect } from 'vitest';
import { app } from '../../src/index';
import type { JsonBody } from '../setup/testContext';

// Served, and served without a token, because it is what a client generates its
// event types from: needing a checkout of this repo to know the envelope shape
// is what let the web app read a field the server had stopped sending.
describe('GET /api/realtime-events.json', () => {
  it('serves the envelope document unauthenticated', async () => {
    const res = await app.request('/api/realtime-events.json');
    expect(res.status).toBe(200);

    const doc = (await res.json()) as JsonBody;
    const schemas = (doc.components as { schemas: Record<string, { oneOf?: unknown[] }> }).schemas;
    expect(doc.openapi).toBeTypeOf('string');
    expect(schemas.RealtimeEvent.oneOf?.length).toBeGreaterThan(0);
    expect(schemas.WebhookEvent.oneOf?.length).toBeGreaterThan(0);
    expect(schemas.TaskCreatedEvent).toBeDefined();
  });

  it('declares no paths, so nothing mistakes it for an HTTP surface', async () => {
    const res = await app.request('/api/realtime-events.json');
    const doc = (await res.json()) as JsonBody;
    expect(doc.paths).toEqual({});
  });
});
