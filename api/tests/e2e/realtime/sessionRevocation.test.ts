import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import {
  deliverLocal,
  subscribeBus,
  SESSIONS_REVOKED,
  type BusEntry,
} from '../../../src/services/realtime/bus';
import { createResetToken } from '../../../src/services/resetToken';
import { TestContext, type TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { waitFor } from '../projects/helpers';
import { RtClient, settle } from './helpers';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sessionIdFor(token: string): Promise<string> {
  const row = await db
    .selectFrom('session')
    .select('session.id')
    .where('session.token_hash', '=', sha256Hex(token))
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('Realtime session revocation', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let user: TestUser;
  const clients: RtClient[] = [];

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    clients.push(client);
    return client;
  }

  async function logIn(): Promise<string> {
    const res = await ctx
      .request()
      .post('/api/auth/login', { email: user.email, password: user.password });
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);
    user = await ctx.createUser('rt-sessions');
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

  it('closes the revoked session socket and leaves the other credentials open', async () => {
    const doomedToken = await logIn();
    const doomedClient = await connect(doomedToken);
    const keptClient = await connect(user.token);
    const tokenRes = await ctx
      .request(user.token)
      .post('/api/auth/tokens', { id: newId(), name: 'rt-session-revoke' });
    expect(tokenRes.status).toBe(201);
    const patClient = await connect(((await tokenRes.json()) as { token: string }).token);

    const res = await ctx
      .request(user.token)
      .delete(`/api/auth/sessions/${await sessionIdFor(doomedToken)}`);
    expect(res.status).toBe(204);

    await waitFor(async () => doomedClient.closeInfo !== null);
    expect(doomedClient.closeInfo?.code).toBe(4401);
    await settle();
    expect(keptClient.closeInfo).toBeNull();
    expect(patClient.closeInfo).toBeNull();
  });

  // Replayed rather than raced: the publish happens before the response is
  // returned, so a socket opened with the new token can only meet the entry the
  // way a slow fan-out would deliver it — after the fact.
  it('spares the session a password change issued when its revocation is replayed', async () => {
    const staleClient = await connect(user.token);

    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));
    let newToken: string;
    try {
      const res = await ctx.request(user.token).post('/api/auth/change-password', {
        current_password: user.password,
        new_password: 'rt-sessions-new-password',
      });
      expect(res.status).toBe(200);
      newToken = ((await res.json()) as { token: string }).token;
    } finally {
      unsubscribe();
    }
    user.token = newToken;
    user.password = 'rt-sessions-new-password';

    await waitFor(async () => staleClient.closeInfo !== null);
    expect(staleClient.closeInfo?.code).toBe(4401);

    const revocation = seen.find((entry) => entry.type === SESSIONS_REVOKED);
    if (revocation === undefined) {
      throw new Error('change-password published no revocation entry');
    }
    expect(revocation.data).toEqual({
      user_id: user.id,
      except_session_id: await sessionIdFor(newToken),
    });

    const freshClient = await connect(newToken);
    deliverLocal(revocation);
    await settle();
    expect(freshClient.closeInfo).toBeNull();

    // Negative control: the same entry without the exception does close it.
    deliverLocal({ ...revocation, data: { user_id: user.id } });
    await waitFor(async () => freshClient.closeInfo !== null);
    expect(freshClient.closeInfo?.code).toBe(4401);
  });

  it('closes every session socket on a password reset, sparing none', async () => {
    const firstClient = await connect(user.token);
    const secondClient = await connect(await logIn());
    const { alternative_id } = await db
      .selectFrom('app_user')
      .select('app_user.alternative_id')
      .where('app_user.id', '=', user.id)
      .executeTakeFirstOrThrow();

    const res = await ctx.request().post('/api/auth/reset-password', {
      token: createResetToken(alternative_id),
      new_password: 'rt-sessions-reset-password',
    });
    expect(res.status).toBe(204);
    user.password = 'rt-sessions-reset-password';

    await waitFor(async () => firstClient.closeInfo !== null && secondClient.closeInfo !== null);
    expect(firstClient.closeInfo?.code).toBe(4401);
    expect(secondClient.closeInfo?.code).toBe(4401);
  });
});
