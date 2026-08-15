import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
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

  // How many sockets the server itself still holds. A peer that keeps its half
  // of a connection open sees no 'close' of its own when the server releases
  // one, so this is the only thing that can distinguish a released descriptor
  // from a leaked one.
  const heldConnections = (): Promise<number> =>
    new Promise((resolve, reject) => {
      (server as unknown as import('node:http').Server).getConnections((err, count) => {
        if (err) reject(err);
        else resolve(count);
      });
    });

  // Accepts and releases both land asynchronously, so poll rather than sleeping
  // a guessed interval; returns whatever it last read on timeout so the
  // caller's assertion is what reports the mismatch.
  async function connectionsUntil(satisfied: (count: number) => boolean): Promise<number> {
    const deadline = Date.now() + 4000;
    let held = await heldConnections();
    while (!satisfied(held) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      held = await heldConnections();
    }
    return held;
  }

  const settledConnections = (expected: number): Promise<number> =>
    connectionsUntil((count) => count <= expected);

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
  //
  // Raw sockets rather than the ws client, for two reasons: the refusal is a
  // plain HTTP response that ws hides behind its own error handling, and
  // allowHalfOpen is what makes the peer stop cooperating — it reads the
  // refusal and never closes its own half, which is exactly the client the
  // ceiling has to survive.
  it('refuses a handshake past the per-address ceiling and closes what it refused', async () => {
    const sockets: net.Socket[] = [];
    const upgrade = (): Promise<{ socket: net.Socket; status: string }> =>
      new Promise((resolve, reject) => {
        const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () => {
          socket.write(
            'GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
              `Sec-WebSocket-Key: ${Buffer.from('0123456789abcdef').toString('base64')}\r\n` +
              'Sec-WebSocket-Version: 13\r\n\r\n'
          );
        });
        sockets.push(socket);
        socket.once('data', (chunk) => resolve({ socket, status: chunk.toString('latin1') }));
        socket.once('error', reject);
      });

    try {
      let refused: { socket: net.Socket; status: string } | null = null;
      for (let i = 0; i <= MAX_SOCKETS_PER_ADDRESS && refused === null; i++) {
        const attempt = await upgrade();
        // Null after the loop means every attempt through the ceiling was
        // accepted; a socket an earlier test is still closing would only move
        // which attempt is refused, never whether one is.
        if (!attempt.status.startsWith('HTTP/1.1 101')) {
          refused = attempt;
        }
      }
      expect(refused?.status).toMatch(/^HTTP\/1\.1 429 /);

      // What the server still holds, not what the client observes: the peer
      // keeps its half open, so its own 'close' never fires and only the
      // server's connection count can say whether the descriptor was released.
      // Refusals are deliberately uncounted by the ceiling, so a refusal the
      // server does not destroy is a socket held outside every bound there is —
      // and tripping the ceiling would be the cheapest way to get one.
      const held = await heldConnections();
      for (let i = 0; i < 20; i++) {
        await upgrade();
      }
      expect(await settledConnections(held)).toBeLessThanOrEqual(held);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
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

  // llhttp accepts request targets WHATWG-URL rejects, and the parse used to
  // throw past the destroy: one leaked descriptor per request, no ceiling
  // involved.
  it('destroys the socket for an upgrade target it cannot parse', async () => {
    const targets = ['//[', '/\\', '//%', 'http://['];
    const connectIdle = (): Promise<net.Socket> =>
      new Promise((resolve, reject) => {
        const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () =>
          resolve(socket)
        );
        socket.on('error', reject);
      });
    // Resolved when the request has left this process, so the poll below is
    // waiting on the server's answer rather than on the write.
    const sendUpgrade = (socket: net.Socket, target: string): Promise<void> =>
      new Promise((resolve) => {
        socket.write(
          `GET ${target} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n` +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Key: ${Buffer.from('0123456789abcdef').toString('base64')}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
          () => resolve()
        );
      });

    const held = await heldConnections();
    const sockets: net.Socket[] = [];
    try {
      for (let index = 0; index < targets.length; index++) {
        sockets.push(await connectIdle());
      }
      // Established before anything is written, and waited for: the accept is
      // what raises the count, and a count read while the connections were
      // still in flight would be the pre-test one — leaving the release below
      // compared against itself.
      expect(await connectionsUntil((count) => count === held + targets.length)).toBe(
        held + targets.length
      );

      await Promise.all(sockets.map((socket, index) => sendUpgrade(socket, targets[index])));
      // The peers keep their half open, so a server that answered the parse
      // failure with end() would hold every one of these forever.
      expect(await settledConnections(held)).toBe(held);
    } finally {
      for (const socket of sockets) {
        socket.destroy();
      }
    }
  });

  // Frames from one read are dispatched synchronously, so two auth frames in a
  // single write both used to pass the "not registered yet" check and both
  // register. The second replaced the first's subscription set, stranding any
  // room joined between them — an entry no close would ever clean up and that
  // no longer counted toward the per-socket ceiling.
  it('acts on one auth frame per socket however many arrive together', async () => {
    const user = await ctx.createUser('rt-limit-double-auth');
    const projectId = newId();
    expect(
      (await ctx.request(user.token).post('/api/projects', { id: projectId, name: 'double auth' }))
        .status
    ).toBe(201);

    const authOks = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      let count = 0;
      ws.on('error', reject);
      ws.on('open', () => {
        const auth = JSON.stringify({ type: 'auth', token: user.token });
        for (let i = 0; i < 20; i++) {
          ws.send(auth);
        }
        ws.send(JSON.stringify({ type: 'subscribe', project_id: projectId }));
      });
      ws.on('message', (raw) => {
        if ((JSON.parse(String(raw)) as { type: string }).type === 'auth_ok') count++;
      });
      // Closed from here and awaited, so the registry assertions below read a
      // settled state rather than one still unwinding.
      setTimeout(() => ws.close(), 600);
      ws.on('close', () => resolve(count));
    });

    expect(authOks).toBe(1);
    await settle();
    expect(socketsForUser(user.id)).toHaveLength(0);
    // Empty because the socket's own cleanup found the subscription, not
    // because a second registration replaced the set holding it — that is the
    // membership no close would ever have reached.
    expect(projectSockets(projectId)).toHaveLength(0);
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
