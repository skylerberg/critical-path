import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, projectSockets } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { clearSentEmails, sentEmails } from '../../../src/services/email/index';
import { TestContext, type TestUser } from '../../setup/testContext';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { waitFor } from '../projects/helpers';
import { RtClient, settle } from './helpers';

const INVITATIONS_CHANGED = 'invitations_changed';

describe('Invitation realtime events', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let ownerClient: RtClient;
  let editorClient: RtClient;
  let viewerClient: RtClient;
  let outsiderClient: RtClient;
  let roomlessEditorClient: RtClient;
  let roomlessViewerClient: RtClient;
  const clients: RtClient[] = [];

  let projectId: string;
  let invitationId: string;
  const invitedAddresses: string[] = [];

  async function connect(token: string): Promise<RtClient> {
    const client = await RtClient.connect(port, token);
    clients.push(client);
    return client;
  }

  // Every socket's whole buffer, so a leak through some other event type is
  // caught as well as one through the invitation event.
  function everythingDelivered(): string {
    return JSON.stringify(clients.map((client) => client.events));
  }

  function expectNoAddressesDelivered(): void {
    const delivered = everythingDelivered();
    for (const address of invitedAddresses) {
      expect(delivered).not.toContain(address);
    }
    expect(delivered).not.toContain('@');
  }

  async function invite(email: string): Promise<string> {
    invitedAddresses.push(email);
    const res = await ctx
      .request(owner.token)
      .post(`/api/projects/${projectId}/members/by-email`, { email });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitation: { id: string } | null };
    if (body.invitation === null) {
      throw new Error('Expected a pending invitation');
    }
    return body.invitation.id;
  }

  // The send is an unawaited post-commit hook, so the mail lands after the
  // response does.
  async function invitationTokenFor(address: string): Promise<string> {
    await waitFor(async () => sentEmails().some((message) => message.to === address));
    const mail = sentEmails().filter((message) => message.to === address);
    expect(mail).toHaveLength(1);
    const match = mail[0].text.match(/\/invite\?token=(\S+)/);
    if (!match) {
      throw new Error(`No invitation token in mail to ${address}`);
    }
    return decodeURIComponent(match[1]);
  }

  beforeAll(async () => {
    process.env.EMAIL_DRIVER = 'memory';
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    owner = await ctx.createUser('inv-rt-owner');
    editor = await ctx.createUser('inv-rt-editor');
    viewer = await ctx.createUser('inv-rt-viewer');
    outsider = await ctx.createUser('inv-rt-outsider');

    projectId = newId();
    const created = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'invitation rt project' });
    expect(created.status).toBe(201);

    const shared = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [editor.id, viewer.id],
      roles: [
        { user_id: editor.id, role: 'editor' },
        { user_id: viewer.id, role: 'viewer' },
      ],
    });
    expect(shared.status).toBe(204);

    // Published so the outsider is a real reader of this board: the room they
    // subscribe to is one they could plausibly have open.
    const published = await ctx
      .request(owner.token)
      .patch(`/api/projects/${projectId}`, { is_public: true });
    expect(published.status).toBe(200);
    const publicRead = await ctx.request().get(`/api/public/projects/${projectId}/board`);
    expect(publicRead.status).toBe(200);

    // The resend and revoke cases below address this invitation. Built before
    // the clients connect, so its own invitations_changed reaches none of their
    // buffers — the publish is a post-commit hook, so it can land after a test
    // has taken its mark — and an invite that breaks fails this hook once
    // rather than leaving those two to address an undefined id.
    invitationId = await invite(uniqueEmail('inv-rt-shared'));

    ownerClient = await connect(owner.token);
    editorClient = await connect(editor.token);
    viewerClient = await connect(viewer.token);
    outsiderClient = await connect(outsider.token);

    for (const client of clients) {
      client.subscribe(projectId);
    }
    await waitFor(async () => projectSockets(projectId).length === 4);

    // Same two accounts again, left out of the room, so what decides who hears
    // is the role rather than the subscription.
    roomlessEditorClient = await connect(editor.token);
    roomlessViewerClient = await connect(viewer.token);
    clearSentEmails();
  });

  afterAll(async () => {
    delete process.env.EMAIL_DRIVER;
    clearSentEmails();
    for (const client of clients) {
      client.close();
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await ctx.cleanup();
  });

  it('publishes invitations_changed to editors on invite, carrying no address', async () => {
    const from = ownerClient.events.length;
    const editorFrom = editorClient.events.length;

    await invite(uniqueEmail('inv-rt-guest'));

    const event = await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from });
    expect(Object.keys(event).sort()).toEqual(['data', 'project_id', 'type']);
    expect(event.project_id).toBe(projectId);
    expect(event.data).toEqual({ project_id: projectId });
    await editorClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from: editorFrom });

    await settle();
    expectNoAddressesDelivered();
  });

  it('publishes invitations_changed on resend', async () => {
    const from = ownerClient.events.length;
    const editorFrom = editorClient.events.length;

    const res = await ctx
      .request(owner.token)
      .post(`/api/projects/${projectId}/invitations/${invitationId}/resend`);
    expect(res.status).toBe(204);

    const event = await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from });
    expect(event.data).toEqual({ project_id: projectId });
    await editorClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from: editorFrom });

    await settle();
    expectNoAddressesDelivered();
  });

  it('publishes invitations_changed on revoke', async () => {
    const from = ownerClient.events.length;
    const editorFrom = editorClient.events.length;

    const res = await ctx
      .request(owner.token)
      .delete(`/api/projects/${projectId}/invitations/${invitationId}`);
    expect(res.status).toBe(204);

    const event = await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from });
    expect(event.data).toEqual({ project_id: projectId });
    await editorClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from: editorFrom });

    await settle();
    expectNoAddressesDelivered();
  });

  it('delivers nothing to a viewer or to a public-board reader who is not a member', async () => {
    const viewerFrom = viewerClient.events.length;
    const outsiderFrom = outsiderClient.events.length;
    const ownerFrom = ownerClient.events.length;

    await invite(uniqueEmail('inv-rt-unseen'));

    await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from: ownerFrom });
    await settle();
    expect(viewerClient.events.slice(viewerFrom)).toEqual([]);
    expect(outsiderClient.events.slice(outsiderFrom)).toEqual([]);
    expect(viewerClient.eventsOfType(INVITATIONS_CHANGED)).toEqual([]);
    expect(outsiderClient.eventsOfType(INVITATIONS_CHANGED)).toEqual([]);
  });

  // The share panel opens from the project list too, and a client sitting there
  // is subscribed to nothing, so a room-only event would leave that panel dead.
  it('reaches an editor in no room, and still not a viewer in no room', async () => {
    const editorFrom = roomlessEditorClient.events.length;
    const viewerFrom = roomlessViewerClient.events.length;

    await invite(uniqueEmail('inv-rt-roomless'));

    const event = await roomlessEditorClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, {
      from: editorFrom,
    });
    expect(event.project_id).toBe(projectId);
    expect(event.data).toEqual({ project_id: projectId });

    await settle();
    expect(roomlessViewerClient.events.slice(viewerFrom)).toEqual([]);
    expect(roomlessViewerClient.eventsOfType(INVITATIONS_CHANGED)).toEqual([]);
    expectNoAddressesDelivered();
  });

  it('publishes invitations_changed when an invited address turns out to have an account', async () => {
    const address = uniqueEmail('inv-rt-mover');
    await invite(address);

    // An address change never claims an invitation, which is the only way an
    // invited address ends up with an account and a pending row at once.
    const mover = await ctx.createUser('inv-rt-mover');
    expect((await ctx.request(mover.token).patch('/api/auth/me', { email: address })).status).toBe(
      200
    );
    const from = ownerClient.events.length;

    const added = await ctx
      .request(owner.token)
      .post(`/api/projects/${projectId}/members/by-email`, { email: address });
    expect(added.status).toBe(200);
    expect(((await added.json()) as { status: string }).status).toBe('member');

    const event = await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from });
    expect(event.data).toEqual({ project_id: projectId });
    await settle();
    expect(viewerClient.eventsOfType(INVITATIONS_CHANGED)).toEqual([]);
    expectNoAddressesDelivered();
  });

  it('publishes invitations_changed when a claim consumes an invitation', async () => {
    clearSentEmails();
    const address = uniqueEmail('inv-rt-accepter');
    await invite(address);
    const token = await invitationTokenFor(address);
    const accepter = await ctx.createUser('inv-rt-accepter');
    const from = ownerClient.events.length;

    const accepted = await ctx.request(accepter.token).post('/api/invitations/accept', { token });
    expect(accepted.status).toBe(200);

    const event = await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from });
    expect(event.data).toEqual({ project_id: projectId });
    await settle();
    expect(viewerClient.eventsOfType(INVITATIONS_CHANGED)).toEqual([]);
    expectNoAddressesDelivered();
  });

  // Last, because it leaves the editor a viewer.
  it('publishes to the remaining editors when a demotion revokes the demoted editor’s invitation', async () => {
    const address = uniqueEmail('inv-rt-demoted');
    invitedAddresses.push(address);
    const beforeInvite = editorClient.events.length;
    const invited = await ctx
      .request(editor.token)
      .post(`/api/projects/${projectId}/members/by-email`, { email: address });
    expect(invited.status).toBe(200);
    // Drained before the demotion, so an invite event still in flight cannot be
    // mistaken for one delivered after the editor became a viewer.
    await editorClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from: beforeInvite });
    await settle();

    const from = ownerClient.events.length;
    const editorFrom = editorClient.events.length;

    const demoted = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      roles: [{ user_id: editor.id, role: 'viewer' }],
    });
    expect(demoted.status).toBe(204);

    const event = await ownerClient.waitForEvent((e) => e.type === INVITATIONS_CHANGED, { from });
    expect(event.data).toEqual({ project_id: projectId });
    await settle();
    expect(
      editorClient.events.slice(editorFrom).filter((e) => e.type === INVITATIONS_CHANGED)
    ).toEqual([]);
    expectNoAddressesDelivered();
  });
});
