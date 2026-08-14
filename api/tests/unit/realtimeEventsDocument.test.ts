import { readdir, readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { buildRealtimeEventsDocument } from '../../src/spec/realtime-events';
import * as closeCodes from '../../src/services/realtime/closeCodes';
import {
  REALTIME_EVENT_TYPES,
  WEBHOOK_EVENT_TYPES,
} from '../../src/services/realtime/eventCatalog';

const REALTIME_DIR = new URL('../../src/services/realtime/', import.meta.url);

// 4000 is where RFC 6455 hands the range to the application. Below it a code
// means the same thing for every WebSocket, so the table deliberately omits
// them and this scan has to as well.
const APPLICATION_RANGE_START = 4000;

// Read out of the source rather than restated here: a list of codes written in
// this file would be a third copy, free to agree with itself while the server
// closes with something else.
//
// Every module in the directory, not just transport.ts: a close moved into a
// sibling — `state.ts` evicting a stale socket, say — type-checks clean and
// would otherwise leave this green while the table, the document and every
// client stayed unaware.
async function closeCallsInRealtime(): Promise<{ codes: number[]; unresolved: string[] }> {
  const exported = new Map<string, number>();
  for (const [name, value] of Object.entries(closeCodes)) {
    if (typeof value === 'number') exported.set(name, value);
  }

  const codes: number[] = [];
  const unresolved: string[] = [];
  const files = (await readdir(REALTIME_DIR)).filter(
    (file) => file.endsWith('.ts') && file !== 'closeCodes.ts'
  );
  for (const file of files) {
    const source = await readFile(new URL(file, REALTIME_DIR), 'utf8');
    // Locals are resolved per file so a constant in one module cannot stand in
    // for a same-named one in another.
    const named = new Map(exported);
    for (const [, name, value] of source.matchAll(/\bconst (\w+) = (\d[\d_]*);/g)) {
      named.set(name, Number(value.replaceAll('_', '')));
    }
    for (const [, argument] of source.matchAll(/\.close\(\s*([A-Za-z_$][\w$]*|\d+)/g)) {
      const code = /^\d+$/.test(argument) ? Number(argument) : named.get(argument);
      if (code === undefined) {
        unresolved.push(argument);
        continue;
      }
      codes.push(code);
    }
  }
  return { codes, unresolved };
}

describe('realtime close codes', () => {
  it('declares exactly the application codes the realtime server can close with', async () => {
    const { codes, unresolved } = await closeCallsInRealtime();

    // Control: the scan reads a real call site, so an empty application-range
    // result below means the server stopped sending one — not that the pattern
    // quietly stopped matching anything at all.
    expect(codes.filter((code) => code < APPLICATION_RANGE_START).length).toBeGreaterThan(0);
    expect(unresolved).toEqual([]);

    const ascending = (a: number, b: number): number => a - b;
    const sent = [...new Set(codes.filter((code) => code >= APPLICATION_RANGE_START))].sort(
      ascending
    );
    expect(sent).toEqual(closeCodes.REALTIME_CLOSE_CODES.map(({ code }) => code).sort(ascending));
  });

  it('publishes every declared code into the document', async () => {
    const { schemas } = (await buildRealtimeEventsDocument()).components as {
      schemas: Record<string, { description?: string; oneOf?: { const?: unknown }[] }>;
    };
    const published = schemas.RealtimeCloseCode.oneOf?.map((member) => member.const);

    expect(published).toEqual(closeCodes.REALTIME_CLOSE_CODES.map(({ code }) => code));
    // The per-member titles and meanings do not survive generation, so this
    // description is the only place a client reader learns what a code means.
    for (const { code, meaning } of closeCodes.REALTIME_CLOSE_CODES) {
      expect(schemas.RealtimeCloseCode.description).toContain(String(code));
      expect(schemas.RealtimeCloseCode.description).toContain(meaning);
    }
  });
});

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
