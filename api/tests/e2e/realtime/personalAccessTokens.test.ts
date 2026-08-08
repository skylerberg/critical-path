import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import WebSocket from 'ws';
import { app } from '../../../src/index';
import { attachRealtime } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { PERSONAL_ACCESS_TOKEN_PREFIX } from '../../../src/services/personalAccessTokens';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { waitFor } from '../projects/helpers';
import { RtClient, settle } from './helpers';

// RtClient only settles on auth_ok, so a rejected handshake needs the raw socket.
function handshakeCloseCode(port: number, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
    ws.on('close', (code) => resolve(code));
  });
}

describe('Realtime with personal access tokens', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let user: TestUser;
  let projectId: string;
  let columnId: string;
  const clients: RtClient[] = [];

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    clients.push(client);
    return client;
  }

  async function mintToken(name: string): Promise<{ id: string; secret: string }> {
    const id = newId();
    const res = await ctx.request(user.token).post('/api/auth/tokens', { id, name });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string };
    return { id, secret: body.token };
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    user = await ctx.createUser('rt-pat');
    projectId = newId();
    const projectRes = await ctx
      .request(user.token)
      .post('/api/projects', { id: projectId, name: 'rt pat project' });
    expect(projectRes.status).toBe(201);
    const payload = (await projectRes.json()) as { columns: Array<{ id: string }> };
    columnId = payload.columns[0].id;
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await ctx.cleanup();
  });

  it('authenticates the handshake and delivers project events', async () => {
    const { secret } = await mintToken('socket');
    const client = await connect(secret);
    client.subscribe(projectId);
    await settle();

    const taskId = newId();
    const res = await ctx.request(user.token).post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: columnId,
      title: 'pat',
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(201);

    const event = await client.waitForEvent((entry) => entry.type === 'task_created');
    expect(event.data.id).toBe(taskId);
  });

  it('closes only the revoked token socket, leaving the session socket open', async () => {
    const doomed = await mintToken('doomed');
    const kept = await mintToken('kept');
    const doomedClient = await connect(doomed.secret);
    const keptClient = await connect(kept.secret);
    const sessionClient = await connect(user.token);

    const res = await ctx.request(user.token).delete(`/api/auth/tokens/${doomed.id}`);
    expect(res.status).toBe(204);

    await waitFor(async () => doomedClient.closeInfo !== null);
    expect(doomedClient.closeInfo?.code).toBe(4401);
    await settle();
    expect(keptClient.closeInfo).toBeNull();
    expect(sessionClient.closeInfo).toBeNull();
  });

  it('leaves both session and token sockets open on a password change', async () => {
    const { secret } = await mintToken('survives-password-change');
    const tokenClient = await connect(secret);
    const sessionClient = await connect(user.token);

    const res = await ctx.request(user.token).post('/api/auth/change-password', {
      current_password: user.password,
      new_password: 'rt-pat-new-password',
    });
    expect(res.status).toBe(204);
    user.password = 'rt-pat-new-password';

    await settle();
    expect(sessionClient.closeInfo).toBeNull();
    expect(tokenClient.closeInfo).toBeNull();
  });

  it('refuses a handshake with an expired token', async () => {
    const secret = `${PERSONAL_ACCESS_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    await db
      .insertInto('personal_access_token')
      .values({
        id: newId(),
        user_id: user.id,
        name: 'expired',
        token_hash: crypto.createHash('sha256').update(secret).digest('hex'),
        expires_at: new Date(Date.now() - 60_000),
      })
      .execute();

    expect(await handshakeCloseCode(port, secret)).toBe(4401);
  });
});
