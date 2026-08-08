import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { createVerificationToken } from '../../../src/services/emailToken';
import { TestContext, type TestUser } from '../../setup/testContext';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { RtClient, settle } from './helpers';

// The self-only half of what userUpdated.test.ts covers: that suite proves the
// public payload reaches sharers carrying no address, this one proves the
// private payload reaches nobody but the subject.
describe('account_updated realtime event', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let subject: TestUser;
  let sharer: TestUser;
  let outsider: TestUser;
  let subjectClient: RtClient;
  let subjectSecondClient: RtClient;
  let sharerClient: RtClient;
  let outsiderClient: RtClient;
  const clients: RtClient[] = [];

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

    subject = await ctx.createUser('au-subject');
    sharer = await ctx.createUser('au-sharer');
    outsider = await ctx.createUser('au-outsider');

    const projectId = newId();
    const projectRes = await ctx
      .request(subject.token)
      .post('/api/projects', { id: projectId, name: 'au project' });
    expect(projectRes.status).toBe(201);
    const shareRes = await ctx
      .request(subject.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [sharer.id] });
    expect(shareRes.status).toBe(204);

    subjectClient = await connect(subject.token);
    subjectSecondClient = await connect(subject.token);
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
    await ctx.cleanup();
  });

  it('delivers a mailbox change to every socket of the subject and to nobody else', async () => {
    const sharerFrom = sharerClient.events.length;
    const newEmail = uniqueEmail('au-moved');

    const res = await ctx.request(subject.token).patch('/api/auth/me', { email: newEmail });
    expect(res.status).toBe(200);
    subject.email = newEmail;

    for (const client of [subjectClient, subjectSecondClient]) {
      const event = await client.waitForEvent((e) => e.type === 'account_updated');
      expect(Object.keys(event).sort()).toEqual(['data', 'project_id', 'type']);
      expect(event.project_id).toBeNull();
      expect(event.data).toEqual({
        id: subject.id,
        name: subject.name,
        avatar_url: null,
        email: newEmail,
        email_verified: false,
      });
    }

    // The sharer is told the public half of the same change and nothing more.
    await sharerClient.waitForEvent((e) => e.type === 'user_updated', { from: sharerFrom });
    await settle();
    expect(sharerClient.eventsOfType('account_updated')).toEqual([]);
    expect(JSON.stringify(sharerClient.events)).not.toContain(newEmail);
    expect(outsiderClient.events).toEqual([]);
  });

  it('delivers the verification flip to the subject alone, and nothing on a replay', async () => {
    const sharerFrom = sharerClient.events.length;
    const subjectFrom = subjectClient.events.length;
    const secondFrom = subjectSecondClient.events.length;
    const token = createVerificationToken(subject.id, subject.email);

    expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);

    const event = await subjectClient.waitForEvent((e) => e.type === 'account_updated', {
      from: subjectFrom,
    });
    expect(event.data).toEqual({
      id: subject.id,
      name: subject.name,
      avatar_url: null,
      email: subject.email,
      email_verified: true,
    });
    await subjectSecondClient.waitForEvent((e) => e.type === 'account_updated', {
      from: secondFrom,
    });

    await settle();
    // Verification publishes no user_updated at all, so a sharer sees silence.
    expect(sharerClient.events.slice(sharerFrom)).toEqual([]);
    expect(outsiderClient.events).toEqual([]);

    const settled = subjectClient.events.length;
    expect((await ctx.request().post('/api/auth/verify-email', { token })).status).toBe(204);
    await settle();
    expect(subjectClient.events.length).toBe(settled);
  });

  it('publishes nothing on a name-only change, which user_updated already carries', async () => {
    const from = subjectClient.events.length;

    const res = await ctx.request(subject.token).patch('/api/auth/me', { name: 'Renamed Live' });
    expect(res.status).toBe(200);
    subject.name = 'Renamed Live';

    await subjectClient.waitForEvent(
      (e) => e.type === 'user_updated' && e.data.name === 'Renamed Live',
      { from }
    );
    await settle();
    expect(subjectClient.events.slice(from).filter((e) => e.type === 'account_updated')).toEqual(
      []
    );
    expect(outsiderClient.events).toEqual([]);
  });
});
