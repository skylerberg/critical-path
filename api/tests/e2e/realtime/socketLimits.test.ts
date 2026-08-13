import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import WebSocket from 'ws';
import { app } from '../../../src/index';
import {
  attachRealtime,
  projectSockets,
  socketsForUser,
  MAX_SOCKETS_PER_ADDRESS,
  MAX_SOCKETS_PER_USER,
} from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { RtClient, settle } from './helpers';

// The ceilings that keep one caller from deciding how much of the process the
// socket layer holds. Every one of them is reachable before a request is ever
// made, so none of them can be a budget the request path spends.
describe('Realtime socket limits', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;
  const opened: RtClient[] = [];

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);
  });

  afterEach(async () => {
    // The socket registry is deliberately outside resetProcessState, so a test
    // that left sockets open would hand the next one a spent per-address budget.
    for (const client of opened.splice(0)) {
      client.close();
    }
    await settle();
  });

  afterAll(async () => {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    opened.push(client);
    return client;
  }

  it('drops the oldest socket once an account holds more than the per-user ceiling', async () => {
    const user = await ctx.createUser('rt-limit-user');

    const first = await connect(user.token);
    for (let i = 1; i < MAX_SOCKETS_PER_USER; i++) {
      await connect(user.token);
    }
    expect(socketsForUser(user.id)).toHaveLength(MAX_SOCKETS_PER_USER);
    expect(first.closeInfo).toBeNull();

    // One past the ceiling: the connection that just arrived is the one that
    // must survive, so a client reconnecting through a half-open socket is not
    // refused by the socket it is replacing.
    const newest = await connect(user.token);
    await settle();

    expect(socketsForUser(user.id)).toHaveLength(MAX_SOCKETS_PER_USER);
    expect(first.closeInfo?.code).toBe(4429);
    expect(newest.closeInfo).toBeNull();
  });

  it('leaves a second account its own full allowance', async () => {
    const busy = await ctx.createUser('rt-limit-busy');
    const other = await ctx.createUser('rt-limit-other');

    for (let i = 0; i <= MAX_SOCKETS_PER_USER; i++) {
      await connect(busy.token);
    }
    await settle();

    const quiet = await connect(other.token);
    await settle();

    expect(quiet.closeInfo).toBeNull();
    expect(socketsForUser(other.id)).toHaveLength(1);
  });

  it('refuses a subscribe to anything that is not a project id', async () => {
    const user = await ctx.createUser('rt-limit-subscribe');
    const client = await connect(user.token);

    client.subscribe('not-a-project-id');
    client.subscribe('../../etc/passwd');
    client.subscribe('x'.repeat(4096));
    await settle();

    expect(projectSockets('not-a-project-id')).toHaveLength(0);
    expect(projectSockets('../../etc/passwd')).toHaveLength(0);
    expect(projectSockets('x'.repeat(4096))).toHaveLength(0);
  });

  // Unauthenticated on purpose: the ceiling has to bite in the handshake
  // window, which is the only part of a socket's life that costs nothing to
  // reach and where no account is known yet.
  it('refuses a handshake past the per-address ceiling with 429', async () => {
    const sockets: WebSocket[] = [];
    // Resolves null for a socket that opened and the status for one refused, so
    // the assertion is "a refusal arrives, and it is a 429" rather than "the
    // Nth attempt exactly": a socket a previous test is still closing counts
    // against the same address and would move N by one.
    const open = (): Promise<number | null> =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.on('open', () => {
          sockets.push(ws);
          resolve(null);
        });
        ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
        ws.on('error', reject);
      });

    try {
      let refused: number | null = null;
      for (let i = 0; i <= MAX_SOCKETS_PER_ADDRESS && refused === null; i++) {
        refused = await open();
      }
      // Null here means every attempt through the ceiling was accepted.
      expect(refused).toBe(429);
    } finally {
      for (const ws of sockets) {
        ws.close();
      }
    }

    // Released as the sockets close, so the ceiling is a concurrency bound and
    // not a budget one address spends for the life of the process.
    await settle();
    const afterRelease = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
    afterRelease.close();
  });

  it('still delivers to a project a live socket subscribed to', async () => {
    const user = await ctx.createUser('rt-limit-delivery');
    const client = await connect(user.token);

    const projectId = newId();
    const created = await ctx
      .request(user.token)
      .post('/api/projects', { id: projectId, name: 'limits project' });
    expect(created.status).toBe(201);

    client.subscribe(projectId);
    await settle();
    expect(projectSockets(projectId)).toHaveLength(1);

    const renamed = await ctx
      .request(user.token)
      .patch(`/api/projects/${projectId}`, { name: 'limits project renamed' });
    expect(renamed.status).toBe(200);

    const event = await client.waitForEvent((e) => e.type === 'project_updated');
    expect(event.project_id).toBe(projectId);
  });
});
