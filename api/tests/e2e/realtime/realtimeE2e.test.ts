import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, projectSockets } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, type TestUser } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { waitFor } from '../projects/helpers';
import { PNG_1X1, RtClient, settle } from './helpers';

describe('Realtime end to end', () => {
  const ctx = new TestContext();
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let userA: TestUser;
  let userB: TestUser;
  let userC: TestUser;
  let clientA: RtClient;
  let clientB: RtClient;
  let clientB2: RtClient;
  let clientC: RtClient;
  const clients: RtClient[] = [];

  let projectId: string;
  let columnId: string;
  let taskId: string;
  let task2Id: string;

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

    userA = await ctx.createUser('rt-a');
    userB = await ctx.createUser('rt-b');
    userC = await ctx.createUser('rt-c');

    projectId = newId();
    const projectRes = await ctx
      .request(userA.token)
      .post('/api/projects', { id: projectId, name: 'rt project' });
    expect(projectRes.status).toBe(201);
    const payload = (await projectRes.json()) as { columns: Array<{ id: string }> };
    columnId = payload.columns[0].id;
    const shareRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [userB.id] });
    expect(shareRes.status).toBe(204);

    clientA = await connect(userA.token);
    clientB = await connect(userB.token);
    clientB2 = await connect(userB.token);
    clientC = await connect(userC.token);

    clientA.subscribe(projectId);
    clientB.subscribe(projectId);
    clientC.subscribe(projectId);
    await waitFor(async () => projectSockets(projectId).length === 3);
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

  it('delivers task_created to subscribed members with the board task shape', async () => {
    taskId = newId();
    const res = await ctx.request(userA.token).post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: columnId,
      title: 'First task',
      position: 1000,
    });
    expect(res.status).toBe(201);

    const event = await clientA.waitForEvent(
      (e) => e.type === 'task_created' && e.data.id === taskId
    );
    expect(Object.keys(event).sort()).toEqual(['data', 'project_id', 'type']);
    expect(event.project_id).toBe(projectId);
    expect(event.data).toMatchObject({
      id: taskId,
      column_id: columnId,
      title: 'First task',
      position: 1000,
      label_ids: [],
      assignee_ids: [],
      blocker_ids: [],
      image_count: 0,
    });

    await clientB.waitForEvent((e) => e.type === 'task_created' && e.data.id === taskId);
    await settle();
    expect(clientB2.eventsOfType('task_created')).toEqual([]);
    expect(clientC.events).toEqual([]);
  });

  it('delivers task_updated', async () => {
    const res = await ctx
      .request(userA.token)
      .patch(`/api/tasks/${taskId}`, { title: 'Renamed task' });
    expect(res.status).toBe(200);

    const event = await clientB.waitForEvent(
      (e) => e.type === 'task_updated' && e.data.id === taskId
    );
    expect(event.project_id).toBe(projectId);
    expect(event.data).toMatchObject({ title: 'Renamed task' });
  });

  it('delivers label_created and task_relations_set for label changes', async () => {
    const labelId = newId();
    const labelRes = await ctx.request(userA.token).post('/api/labels', {
      id: labelId,
      project_id: projectId,
      name: 'rt label',
      color: '#ff0000',
    });
    expect(labelRes.status).toBe(201);
    const labelEvent = await clientB.waitForEvent(
      (e) => e.type === 'label_created' && e.data.id === labelId
    );
    expect(labelEvent.project_id).toBe(projectId);
    expect(labelEvent.data).toMatchObject({ name: 'rt label', color: '#ff0000' });

    const setRes = await ctx
      .request(userA.token)
      .put(`/api/tasks/${taskId}/labels`, { label_ids: [labelId] });
    expect(setRes.status).toBe(204);
    const relationsEvent = await clientB.waitForEvent(
      (e) => e.type === 'task_relations_set' && e.data.task_id === taskId
    );
    expect(relationsEvent.project_id).toBe(projectId);
    expect(relationsEvent.data).toEqual({
      task_id: taskId,
      label_ids: [labelId],
      assignee_ids: [],
      blocker_ids: [],
    });
  });

  it('delivers task_relations_set for assignee and blocker changes', async () => {
    const assignRes = await ctx
      .request(userA.token)
      .put(`/api/tasks/${taskId}/assignees`, { user_ids: [userB.id] });
    expect(assignRes.status).toBe(204);
    await clientA.waitForEvent(
      (e) =>
        e.type === 'task_relations_set' &&
        e.data.task_id === taskId &&
        JSON.stringify(e.data.assignee_ids) === JSON.stringify([userB.id])
    );

    task2Id = newId();
    const taskRes = await ctx.request(userA.token).post('/api/tasks', {
      id: task2Id,
      project_id: projectId,
      column_id: columnId,
      title: 'Blocker task',
      position: 2000,
    });
    expect(taskRes.status).toBe(201);

    const blockRes = await ctx
      .request(userA.token)
      .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: task2Id });
    expect(blockRes.status).toBe(204);
    await clientA.waitForEvent(
      (e) =>
        e.type === 'task_relations_set' &&
        e.data.task_id === taskId &&
        JSON.stringify(e.data.blocker_ids) === JSON.stringify([task2Id])
    );

    const unblockRes = await ctx
      .request(userA.token)
      .delete(`/api/tasks/${taskId}/blockers/${task2Id}`);
    expect(unblockRes.status).toBe(204);
    await clientA.waitForEvent(
      (e) =>
        e.type === 'task_relations_set' &&
        e.data.task_id === taskId &&
        JSON.stringify(e.data.blocker_ids) === JSON.stringify([]) &&
        JSON.stringify(e.data.assignee_ids) === JSON.stringify([userB.id])
    );
  });

  it('delivers column lifecycle events including moved tasks on delete', async () => {
    const newColumnId = newId();
    const createRes = await ctx.request(userA.token).post('/api/columns', {
      id: newColumnId,
      project_id: projectId,
      name: 'Temp column',
      position: 9000,
    });
    expect(createRes.status).toBe(201);
    const createdEvent = await clientB.waitForEvent(
      (e) => e.type === 'column_created' && e.data.id === newColumnId
    );
    expect(createdEvent.project_id).toBe(projectId);
    expect(createdEvent.data).toMatchObject({
      name: 'Temp column',
      position: 9000,
      is_done: false,
    });

    const patchRes = await ctx
      .request(userA.token)
      .patch(`/api/columns/${newColumnId}`, { name: 'Renamed column' });
    expect(patchRes.status).toBe(200);
    await clientB.waitForEvent(
      (e) => e.type === 'column_updated' && e.data.name === 'Renamed column'
    );

    const moveRes = await ctx
      .request(userA.token)
      .patch(`/api/tasks/${task2Id}`, { column_id: newColumnId, position: 1000 });
    expect(moveRes.status).toBe(200);

    const deleteRes = await ctx
      .request(userA.token)
      .delete(`/api/columns/${newColumnId}?move_tasks_to=${columnId}`);
    expect(deleteRes.status).toBe(200);
    const deletedEvent = await clientB.waitForEvent(
      (e) => e.type === 'column_deleted' && e.data.id === newColumnId
    );
    expect(deletedEvent.data.moved_tasks).toMatchObject([{ id: task2Id, column_id: columnId }]);
  });

  it('delivers image_created and image_deleted with image counts', async () => {
    const imageId = newId();
    const form = new FormData();
    form.append('file', new File([new Uint8Array(PNG_1X1)], 'pixel.png', { type: 'image/png' }));
    form.append('id', imageId);
    const uploadRes = await ctx
      .request(userA.token)
      .postMultipart(`/api/tasks/${taskId}/images`, form);
    expect(uploadRes.status).toBe(201);

    const createdEvent = await clientB.waitForEvent(
      (e) => e.type === 'image_created' && e.data.id === imageId
    );
    expect(createdEvent.project_id).toBe(projectId);
    expect(createdEvent.data).toMatchObject({
      id: imageId,
      url: `/api/images/${imageId}`,
      filename: 'pixel.png',
      content_type: 'image/png',
      task_id: taskId,
      image_count: 1,
    });

    const deleteRes = await ctx.request(userA.token).delete(`/api/images/${imageId}`);
    expect(deleteRes.status).toBe(204);
    const deletedEvent = await clientB.waitForEvent((e) => e.type === 'image_deleted');
    expect(deletedEvent.project_id).toBe(projectId);
    expect(deletedEvent.data).toEqual({ task_id: taskId, image_count: 0 });
  });

  it('delivers task_deleted', async () => {
    const res = await ctx.request(userA.token).delete(`/api/tasks/${task2Id}`);
    expect(res.status).toBe(204);
    const event = await clientA.waitForEvent(
      (e) => e.type === 'task_deleted' && e.data.id === task2Id
    );
    expect(event.project_id).toBe(projectId);
    expect(event.data).toEqual({ id: task2Id });
  });

  it('broadcasts project_updated with member_ids to unsubscribed members but not outsiders', async () => {
    const res = await ctx
      .request(userA.token)
      .patch(`/api/projects/${projectId}`, { name: 'Renamed project' });
    expect(res.status).toBe(200);

    const event = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId
    );
    expect(event.data).toMatchObject({
      id: projectId,
      name: 'Renamed project',
      member_ids: [userB.id],
      open_task_count: 1,
      done_task_count: 0,
    });
    await settle();
    expect(clientC.events).toEqual([]);
  });

  it('sends project_deleted to everyone who had access before the delete', async () => {
    const otherProjectId = newId();
    const createRes = await ctx
      .request(userA.token)
      .post('/api/projects', { id: otherProjectId, name: 'doomed project' });
    expect(createRes.status).toBe(201);
    await clientA.waitForEvent((e) => e.type === 'project_created' && e.data.id === otherProjectId);

    const shareRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${otherProjectId}/members`, { user_ids: [userB.id] });
    expect(shareRes.status).toBe(204);
    await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === otherProjectId
    );

    const deleteRes = await ctx.request(userA.token).delete(`/api/projects/${otherProjectId}`);
    expect(deleteRes.status).toBe(204);
    const event = await clientB2.waitForEvent(
      (e) => e.type === 'project_deleted' && e.data.id === otherProjectId
    );
    expect(event).toMatchObject({
      type: 'project_deleted',
      project_id: otherProjectId,
      data: { id: otherProjectId },
    });
    await settle();
    expect(clientC.events).toEqual([]);
  });

  it('delivers project_updated with the new member list when a user is added', async () => {
    const sharedProjectId = newId();
    const createRes = await ctx
      .request(userA.token)
      .post('/api/projects', { id: sharedProjectId, name: 'gaining project' });
    expect(createRes.status).toBe(201);
    await settle();
    const beforeGain = clientB2.events.length;

    const addRes = await ctx
      .request(userA.token)
      .post(`/api/projects/${sharedProjectId}/members/by-email`, { email: userB.email });
    expect(addRes.status).toBe(200);

    const gained = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === sharedProjectId
    );
    expect(gained.data).toMatchObject({ member_ids: [userB.id] });
    expect(clientB2.events.slice(0, beforeGain).map((e) => e.data.id)).not.toContain(
      sharedProjectId
    );

    const cleanupRes = await ctx.request(userA.token).delete(`/api/projects/${sharedProjectId}`);
    expect(cleanupRes.status).toBe(204);
  });

  it('evicts removed members via project_deleted, strips their assignments, then goes quiet', async () => {
    const res = await ctx
      .request(userA.token)
      .put(`/api/projects/${projectId}/members`, { user_ids: [] });
    expect(res.status).toBe(204);

    const evicted = await clientB.waitForEvent(
      (e) => e.type === 'project_deleted' && e.data.id === projectId
    );
    expect(evicted).toMatchObject({
      type: 'project_deleted',
      project_id: projectId,
      data: { id: projectId },
    });
    await clientB2.waitForEvent((e) => e.type === 'project_deleted' && e.data.id === projectId);

    const stripEvent = await clientA.waitForEvent(
      (e) => e.type === 'task_relations_set' && e.data.task_id === taskId
    );
    expect(stripEvent.data).toMatchObject({ assignee_ids: [] });

    const updated = await clientA.waitForEvent(
      (e) =>
        e.type === 'project_updated' &&
        e.data.id === projectId &&
        JSON.stringify(e.data.member_ids) === JSON.stringify([])
    );
    expect(updated.data).toMatchObject({ member_ids: [] });

    const quietFrom = clientB.events.length;
    const newTaskId = newId();
    const taskRes = await ctx.request(userA.token).post('/api/tasks', {
      id: newTaskId,
      project_id: projectId,
      column_id: columnId,
      title: 'After removal',
      position: 3000,
    });
    expect(taskRes.status).toBe(201);
    await clientA.waitForEvent((e) => e.type === 'task_created' && e.data.id === newTaskId);
    await settle();
    expect(clientB.events.length).toBe(quietFrom);
  });

  it('never delivered anything to a client without project access', async () => {
    await settle();
    expect(clientC.events).toEqual([]);
  });

  it('only delivered project list events to the unsubscribed client', () => {
    expect(clientB2.events.length).toBeGreaterThan(0);
    for (const event of clientB2.events) {
      expect(event.type).toMatch(/^project_/);
    }
  });

  it('closes sockets with 4401 when the session is revoked', async () => {
    const userD = await ctx.createUser('rt-d');
    const clientD = await connect(userD.token);

    const res = await ctx.request(userD.token).post('/api/auth/change-password', {
      current_password: userD.password,
      new_password: 'brand-new-password-123',
    });
    expect(res.status).toBe(200);

    await waitFor(async () => clientD.closeInfo !== null);
    expect(clientD.closeInfo).toEqual({ code: 4401, reason: 'Session revoked' });
  });
});
