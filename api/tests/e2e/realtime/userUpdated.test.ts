import path from 'path';
import { promises as fs } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { env } from '../../../src/config/env';
import { TestContext, type TestUser } from '../../setup/testContext';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { PNG_1X1, RtClient, settle } from './helpers';

function avatarForm(bytes: Buffer): FormData {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(bytes)], 'avatar.png', { type: 'image/png' }));
  return form;
}

describe('user_updated realtime event', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let changer: TestUser;
  let sharer: TestUser;
  let outsider: TestUser;
  let changerClient: RtClient;
  let changerSecondClient: RtClient;
  let sharerClient: RtClient;
  let outsiderClient: RtClient;
  const clients: RtClient[] = [];
  const uploadedKeys: string[] = [];

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    changer = await ctx.createUser('uu-changer');
    sharer = await ctx.createUser('uu-sharer');
    outsider = await ctx.createUser('uu-outsider');

    const projectId = newId();
    const projectRes = await ctx
      .request(changer.token)
      .post('/api/projects', { id: projectId, name: 'uu project' });
    expect(projectRes.status).toBe(201);
    const shareRes = await ctx
      .request(changer.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [sharer.id] });
    expect(shareRes.status).toBe(204);

    changerClient = await connect(changer.token);
    changerSecondClient = await connect(changer.token);
    sharerClient = await connect(sharer.token);
    outsiderClient = await connect(outsider.token);
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await Promise.all(
      uploadedKeys.map((key) => fs.rm(path.join(env.storageDiskRoot, key), { force: true }))
    );
    await ctx.cleanup();
  });

  it('delivers user_updated on avatar upload to sharers and the changer’s other sockets, not outsiders', async () => {
    const res = await ctx
      .request(changer.token)
      .postMultipart('/api/auth/me/avatar', avatarForm(PNG_1X1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { avatar_url: string };
    uploadedKeys.push(body.avatar_url.replace('/api/avatars/', ''));

    const event = await sharerClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.id === changer.id
    );
    expect(Object.keys(event).sort()).toEqual(['data', 'project_id', 'type']);
    expect(event.project_id).toBeNull();
    expect(event.data).toEqual({
      id: changer.id,
      email: changer.email,
      name: changer.name,
      avatar_url: body.avatar_url,
    });

    await changerClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.avatar_url === body.avatar_url
    );
    await changerSecondClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.avatar_url === body.avatar_url
    );
    await settle();
    expect(outsiderClient.events).toEqual([]);
  });

  it('delivers user_updated with a null avatar_url on avatar removal', async () => {
    const res = await ctx.request(changer.token).delete('/api/auth/me/avatar');
    expect(res.status).toBe(200);

    const event = await sharerClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.avatar_url === null
    );
    expect(event.project_id).toBeNull();
    expect(event.data).toEqual({
      id: changer.id,
      email: changer.email,
      name: changer.name,
      avatar_url: null,
    });

    await changerSecondClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.avatar_url === null
    );
    await settle();
    expect(outsiderClient.events).toEqual([]);
  });

  it('emits nothing on an idempotent avatar removal', async () => {
    const before = sharerClient.events.length;
    const res = await ctx.request(changer.token).delete('/api/auth/me/avatar');
    expect(res.status).toBe(200);

    await settle();
    expect(sharerClient.events.length).toBe(before);
  });

  it('delivers user_updated on a profile name change', async () => {
    const res = await ctx.request(changer.token).patch('/api/auth/me', { name: 'Renamed Live' });
    expect(res.status).toBe(200);

    const event = await sharerClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.name === 'Renamed Live'
    );
    expect(event.project_id).toBeNull();
    expect(event.data).toEqual({
      id: changer.id,
      email: changer.email,
      name: 'Renamed Live',
      avatar_url: null,
    });

    await changerClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.name === 'Renamed Live'
    );
    await changerSecondClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.name === 'Renamed Live'
    );
    await settle();
    expect(outsiderClient.events).toEqual([]);
  });

  it('delivers user_updated on an email change without reaching outsiders', async () => {
    const newEmail = uniqueEmail('uu-changed');
    const res = await ctx.request(changer.token).patch('/api/auth/me', { email: newEmail });
    expect(res.status).toBe(200);

    const event = await sharerClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.email === newEmail
    );
    expect(event.data).toEqual({
      id: changer.id,
      email: newEmail,
      name: 'Renamed Live',
      avatar_url: null,
    });
    changer.email = newEmail;

    await changerSecondClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.email === newEmail
    );
    await settle();
    expect(outsiderClient.events).toEqual([]);
  });

  it('emits nothing on a no-op PATCH /me', async () => {
    const before = sharerClient.events.length;
    const beforeOwn = changerSecondClient.events.length;

    const empty = await ctx.request(changer.token).patch('/api/auth/me', {});
    expect(empty.status).toBe(200);
    const sameValues = await ctx
      .request(changer.token)
      .patch('/api/auth/me', { name: 'Renamed Live', email: changer.email });
    expect(sameValues.status).toBe(200);

    await settle();
    expect(sharerClient.events.length).toBe(before);
    expect(changerSecondClient.events.length).toBe(beforeOwn);
    expect(outsiderClient.events).toEqual([]);
  });

  it('does not deliver a sharer’s change to users outside their projects', async () => {
    const before = changerClient.events.length;
    const res = await ctx
      .request(outsider.token)
      .patch('/api/auth/me', { name: 'Outsider Renamed' });
    expect(res.status).toBe(200);

    await outsiderClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.name === 'Outsider Renamed'
    );
    await settle();
    expect(changerClient.events.length).toBe(before);
    expect(sharerClient.eventsOfType('user_updated').some((e) => e.data.id === outsider.id)).toBe(
      false
    );
  });
});
