import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, projectSockets } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, type TestUser } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { deleteProjects, insertTask, waitFor } from '../projects/helpers';
import { RtClient, settle } from './helpers';

import { rankKey } from '../../helpers/fixtures';
describe('Realtime for the unseen-changes dot', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let ownerOnBoard: RtClient;
  let ownerElsewhere: RtClient;
  let memberElsewhere: RtClient;
  let outsiderClient: RtClient;
  const clients: RtClient[] = [];

  let projectId: string;
  let columnId: string;
  let taskId: string;

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

    owner = await ctx.createUser('seen-rt-owner');
    member = await ctx.createUser('seen-rt-member');
    outsider = await ctx.createUser('seen-rt-outsider');

    projectId = newId();
    const created = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'seen rt' });
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { columns: Array<{ id: string }> };
    columnId = payload.columns[0]!.id;
    taskId = await insertTask({ projectId, columnId });

    const shared = await ctx
      .request(owner.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [member.id] });
    expect(shared.status).toBe(204);

    ownerOnBoard = await connect(owner.token);
    ownerElsewhere = await connect(owner.token);
    memberElsewhere = await connect(member.token);
    outsiderClient = await connect(outsider.token);

    ownerOnBoard.subscribe(projectId);
    await waitFor(async () => projectSockets(projectId).length === 1);
  });

  afterAll(async () => {
    for (const client of clients) {
      client.close();
    }
    realtime.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await deleteProjects([projectId]);
    await ctx.cleanup();
  });

  it('never carries a per-reader answer in the project_updated broadcast', async () => {
    expect(
      (await ctx.request(member.token).put(`/api/projects/${projectId}/seen`, {})).status
    ).toBe(204);
    const renamed = await ctx
      .request(owner.token)
      .patch(`/api/projects/${projectId}`, { name: 'Renamed for readers' });
    expect(renamed.status).toBe(200);

    const event = await memberElsewhere.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId
    );
    expect(event.data).toMatchObject({ name: 'Renamed for readers' });
    for (const key of ['has_unseen_changes', 'last_seen_at', 'sort_key']) {
      expect(Object.keys(event.data)).not.toContain(key);
    }
  });

  it('sends project_seen to every socket of the caller and to nobody else', async () => {
    const before = memberElsewhere.events.length;
    const res = await ctx.request(owner.token).put(`/api/projects/${projectId}/seen`, {});
    expect(res.status).toBe(204);

    for (const client of [ownerOnBoard, ownerElsewhere]) {
      const event = await client.waitForEvent((e) => e.type === 'project_seen');
      expect(event.project_id).toBe(projectId);
      expect(event.data).toEqual({ id: projectId });
    }
    await settle();
    expect(memberElsewhere.events.slice(before).filter((e) => e.type === 'project_seen')).toEqual(
      []
    );
    expect(outsiderClient.events).toEqual([]);
  });

  it('reaches a member who is subscribed to no room, and carries the actor', async () => {
    const before = memberElsewhere.events.length;
    const res = await ctx
      .request(owner.token)
      .patch(`/api/tasks/${taskId}`, { title: 'Touched by the owner' });
    expect(res.status).toBe(200);

    const event = await memberElsewhere.waitForEvent((e) => e.type === 'project_changed', {
      from: before,
    });
    expect(event.project_id).toBe(projectId);
    expect(event.data).toEqual({ id: projectId, actor_user_id: owner.id });
    await settle();
    expect(outsiderClient.events).toEqual([]);
  });

  it('sends exactly one per request however many events that request published', async () => {
    const before = memberElsewhere.events.length;
    const ids = [newId(), newId(), newId()];
    const res = await ctx.request(owner.token).post('/api/tasks/batch', {
      project_id: projectId,
      column_id: columnId,
      tasks: ids.map((id, index) => ({
        id,
        title: `Batch ${index}`,
        sort_key: rankKey(5000 + index),
      })),
    });
    expect(res.status).toBe(201);

    for (const id of ids) {
      await ownerOnBoard.waitForEvent((e) => e.type === 'task_created' && e.data.id === id);
    }
    await settle();
    expect(
      memberElsewhere.events.slice(before).filter((e) => e.type === 'project_changed')
    ).toHaveLength(1);
  });

  it('stays silent for a mutation a board read would not report either', async () => {
    const before = memberElsewhere.events.length;
    const label = await ctx.request(owner.token).post('/api/labels', {
      id: newId(),
      project_id: projectId,
      name: 'quiet label',
      color: '#123456',
    });
    expect(label.status).toBe(201);
    await ownerOnBoard.waitForEvent((e) => e.type === 'label_created');

    // Archiving takes its card off the board and its activity with it, so a
    // reader would find nothing changed.
    const archived = await ctx.request(owner.token).post(`/api/tasks/${taskId}/archive`);
    expect(archived.status).toBe(200);
    await ownerOnBoard.waitForEvent((e) => e.type === 'task_archived');

    await settle();
    expect(
      memberElsewhere.events.slice(before).filter((e) => e.type === 'project_changed')
    ).toEqual([]);
  });
});
