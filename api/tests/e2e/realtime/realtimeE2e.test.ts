import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, projectSockets } from '../../../src/services/realtime/index';
import type { RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, type TestUser } from '../../setup/testContext';
import { uploadPath, newId, rankKey } from '../../helpers/fixtures';
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

    // Nine tests below mutate this card and assert on the events that follow.
    // Built before the clients connect, so it reaches none of their buffers and
    // a create that breaks fails this hook once instead of leaving those nine
    // to patch an undefined id.
    taskId = newId();
    const sharedTask = await ctx.request(userA.token).post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: columnId,
      title: 'Shared task',
      sort_key: rankKey(1000),
    });
    expect(sharedTask.status).toBe(201);

    task2Id = newId();
    const blockerTask = await ctx.request(userA.token).post('/api/tasks', {
      id: task2Id,
      project_id: projectId,
      column_id: columnId,
      title: 'Blocker task',
      sort_key: rankKey(2000),
    });
    expect(blockerTask.status).toBe(201);

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
    const createdId = newId();
    try {
      const res = await ctx.request(userA.token).post('/api/tasks', {
        id: createdId,
        project_id: projectId,
        column_id: columnId,
        title: 'First task',
        sort_key: rankKey(1000),
      });
      expect(res.status).toBe(201);

      const event = await clientA.waitForEvent(
        (e) => e.type === 'task_created' && e.data.id === createdId
      );
      expect(Object.keys(event).sort()).toEqual(['data', 'project_id', 'type']);
      expect(event.project_id).toBe(projectId);
      expect(event.data).toMatchObject({
        id: createdId,
        column_id: columnId,
        title: 'First task',
        sort_key: expect.any(String),
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        cover_image_url: null,
        comment_count: 0,
      });

      await clientB.waitForEvent((e) => e.type === 'task_created' && e.data.id === createdId);
      await settle();
      expect(clientB2.eventsOfType('task_created')).toEqual([]);
      expect(clientC.events).toEqual([]);
    } finally {
      // Later cases assert on this project's task counts, so nothing created
      // here may outlive the test, failure included.
      await ctx.request(userA.token).post(`/api/tasks/${createdId}/archive`);
      await ctx.request(userA.token).delete(`/api/tasks/${createdId}`);
    }
  });

  it('names the acting user on a board change, to the actor as well as everyone else', async () => {
    const taskId = newId();
    expect(
      (
        await ctx.request(userA.token).post('/api/tasks', {
          id: taskId,
          project_id: projectId,
          column_id: columnId,
          title: 'Attributed',
          sort_key: rankKey(),
        })
      ).status
    ).toBe(201);

    // Not withheld from its own author: their other devices still have to apply
    // it, and it is the client that decides to ignore its own.
    for (const client of [clientA, clientB]) {
      const created = await client.waitForEvent(
        (e) => e.type === 'task_created' && e.data.id === taskId
      );
      expect(created.data.actor_user_id).toBe(userA.id);
    }

    // The acting user, not the project's owner: userB is a member here, and a
    // payload built from the row rather than the request would name userA again.
    const commentId = newId();
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'mine' }] }],
    };
    expect(
      (
        await ctx
          .request(userB.token)
          .post('/api/comments', { id: commentId, task_id: taskId, body })
      ).status
    ).toBe(201);
    const comment = await clientA.waitForEvent(
      (e) => e.type === 'comment_created' && e.data.id === commentId
    );
    expect(comment.data.actor_user_id).toBe(userB.id);

    // The shared project's task counts are asserted further down, so the card
    // has to leave again — and only an archived one can be deleted.
    expect((await ctx.request(userA.token).post(`/api/tasks/${taskId}/archive`)).status).toBe(200);
    expect((await ctx.request(userA.token).delete(`/api/tasks/${taskId}`)).status).toBe(204);
  });

  it('delivers one task_created per task in a batch', async () => {
    const ids = [newId(), newId(), newId()];
    try {
      const res = await ctx.request(userA.token).post('/api/tasks/batch', {
        project_id: projectId,
        column_id: columnId,
        tasks: ids.map((id, index) => ({
          id,
          title: `Batch ${index}`,
          sort_key: rankKey(4000 + index * 1000),
        })),
      });
      expect(res.status).toBe(201);

      for (const id of ids) {
        await clientB.waitForEvent((e) => e.type === 'task_created' && e.data.id === id);
      }
      await settle();

      const delivered = clientB
        .eventsOfType('task_created')
        .filter((e) => ids.includes(e.data.id as string));
      expect(delivered).toHaveLength(3);
      expect(delivered.map((e) => e.data.id as string).sort()).toEqual([...ids].sort());
      expect(delivered.every((e) => e.project_id === projectId)).toBe(true);
    } finally {
      // Later cases assert on this project's task counts, so nothing created
      // here may outlive the test, failure included.
      for (const id of ids) {
        await ctx.request(userA.token).post(`/api/tasks/${id}/archive`);
        await ctx.request(userA.token).delete(`/api/tasks/${id}`);
      }
    }
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

  it('carries a changed due date in the task_updated payload', async () => {
    const res = await ctx
      .request(userA.token)
      .patch(`/api/tasks/${taskId}`, { due_date: '2026-08-03' });
    expect(res.status).toBe(200);

    const event = await clientB.waitForEvent(
      (e) => e.type === 'task_updated' && e.data.due_date === '2026-08-03'
    );
    expect(event.data).toMatchObject({ id: taskId });
  });

  it('publishes no task_updated when the precondition fails', async () => {
    const before = clientB.eventsOfType('task_updated').length;

    const res = await ctx.request(userA.token).patch(`/api/tasks/${taskId}`, {
      title: 'Stale rename',
      expected_updated_at: '2020-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(409);

    await settle();
    expect(clientB.eventsOfType('task_updated')).toHaveLength(before);
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
      open_cross_project_blocker_count: 0,
      actor_user_id: userA.id,
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

  const key9000 = rankKey(9000);
  it('delivers column lifecycle events including moved tasks on delete', async () => {
    const newColumnId = newId();
    const createRes = await ctx.request(userA.token).post('/api/columns', {
      id: newColumnId,
      project_id: projectId,
      name: 'Temp column',
      sort_key: key9000,
    });
    expect(createRes.status).toBe(201);
    const createdEvent = await clientB.waitForEvent(
      (e) => e.type === 'column_created' && e.data.id === newColumnId
    );
    expect(createdEvent.project_id).toBe(projectId);
    expect(createdEvent.data).toMatchObject({
      name: 'Temp column',
      sort_key: expect.any(String),
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
      .patch(`/api/tasks/${task2Id}`, { column_id: newColumnId, sort_key: rankKey(1000) });
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

  describe('column bulk actions', () => {
    let nextPosition = 20_000;
    const bulkColumns: string[] = [];
    const bulkTasks: string[] = [];

    async function makeColumn(name: string): Promise<string> {
      const id = newId();
      nextPosition += 1000;
      const res = await ctx.request(userA.token).post('/api/columns', {
        id,
        project_id: projectId,
        name,
        position: nextPosition,
      });
      expect(res.status).toBe(201);
      bulkColumns.push(id);
      return id;
    }

    async function makeTask(columnId_: string, position: number): Promise<string> {
      const id = newId();
      const res = await ctx.request(userA.token).post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: columnId_,
        title: `bulk ${position}`,
        sort_key: rankKey(position),
      });
      expect(res.status).toBe(201);
      bulkTasks.push(id);
      return id;
    }

    // The rest of the file asserts on this project's task counts, so nothing
    // these tests create may outlive them.
    afterAll(async () => {
      for (const id of bulkTasks) {
        await ctx.request(userA.token).post(`/api/tasks/${id}/archive`);
        await ctx.request(userA.token).delete(`/api/tasks/${id}`);
      }
      for (const id of bulkColumns) {
        await ctx.request(userA.token).delete(`/api/columns/${id}`);
      }
    });

    it('delivers one batched column_tasks_moved and no per-task events', async () => {
      const sourceId = await makeColumn('Bulk source');
      const targetId = await makeColumn('Bulk target');
      const first = await makeTask(sourceId, 1000);
      const second = await makeTask(sourceId, 2000);

      const from = clientB.events.length;
      const res = await ctx
        .request(userA.token)
        .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
      expect(res.status).toBe(200);

      const event = await clientB.waitForEvent((e) => e.type === 'column_tasks_moved', { from });
      expect(event.project_id).toBe(projectId);
      expect(event.data).toMatchObject({ column_id: sourceId, target_column_id: targetId });
      expect(event.data.moved_tasks).toMatchObject([
        { id: first, column_id: targetId },
        { id: second, column_id: targetId },
      ]);

      await settle();
      const since = clientB.events.slice(from);
      expect(since.filter((e) => e.type === 'column_tasks_moved')).toHaveLength(1);
      expect(since.filter((e) => e.type === 'task_updated')).toEqual([]);
      expect(clientC.events).toEqual([]);
    });

    it('publishes nothing when the source column is empty', async () => {
      const sourceId = await makeColumn('Bulk empty source');
      const targetId = await makeColumn('Bulk empty target');

      const from = clientB.events.length;
      const res = await ctx
        .request(userA.token)
        .post(`/api/columns/${sourceId}/move-tasks`, { target_column_id: targetId });
      expect(res.status).toBe(200);

      await settle();
      expect(clientB.events.slice(from).filter((e) => e.type === 'column_tasks_moved')).toEqual([]);
    });

    it('delivers exactly one column_tasks_archived for a three-card column', async () => {
      const bulkColumnId = await makeColumn('Bulk archive');
      const ids = [
        await makeTask(bulkColumnId, 1000),
        await makeTask(bulkColumnId, 2000),
        await makeTask(bulkColumnId, 3000),
      ];

      const from = clientB.events.length;
      const res = await ctx.request(userA.token).post(`/api/columns/${bulkColumnId}/archive-tasks`);
      expect(res.status).toBe(200);

      const event = await clientB.waitForEvent((e) => e.type === 'column_tasks_archived', { from });
      expect(event.project_id).toBe(projectId);
      expect(event.data.column_id).toBe(bulkColumnId);
      const tasks = event.data.tasks as Array<{ id: string; archived_at: string }>;
      expect(tasks.map((task) => task.id)).toEqual(ids);
      expect(tasks.every((task) => typeof task.archived_at === 'string')).toBe(true);

      await settle();
      const since = clientB.events.slice(from);
      expect(since.filter((e) => e.type === 'column_tasks_archived')).toHaveLength(1);
      expect(since.filter((e) => e.type === 'task_archived')).toEqual([]);
      expect(clientC.events).toEqual([]);
    });

    it('publishes nothing when every task in the column is already archived', async () => {
      const bulkColumnId = await makeColumn('Bulk archive twice');
      await makeTask(bulkColumnId, 1000);
      expect(
        (await ctx.request(userA.token).post(`/api/columns/${bulkColumnId}/archive-tasks`)).status
      ).toBe(200);
      await settle();

      const from = clientB.events.length;
      const res = await ctx.request(userA.token).post(`/api/columns/${bulkColumnId}/archive-tasks`);
      expect(res.status).toBe(200);

      await settle();
      expect(clientB.events.slice(from)).toEqual([]);
    });

    const key1500 = rankKey(1500);
    it('delivers one task_created when a task is duplicated', async () => {
      const duplicateColumnId = await makeColumn('Duplicate a card');
      const sourceId = await makeTask(duplicateColumnId, 1000);
      const copyId = newId();
      bulkTasks.push(copyId);
      // The source card's own task_created is still in flight; without this it
      // lands after `from` and inflates the count below.
      await settle();

      const from = clientB.events.length;
      const res = await ctx
        .request(userA.token)
        .post(`/api/tasks/${sourceId}/duplicate`, { id: copyId, sort_key: key1500 });
      expect(res.status).toBe(201);

      const event = await clientB.waitForEvent(
        (e) => e.type === 'task_created' && e.data.id === copyId,
        { from }
      );
      expect(event.project_id).toBe(projectId);
      expect(event.data).toMatchObject({
        column_id: duplicateColumnId,
        sort_key: expect.any(String),
      });

      await settle();
      expect(clientB.events.slice(from).filter((e) => e.type === 'task_created')).toHaveLength(1);
      expect(clientC.events).toEqual([]);
    });

    it('delivers column_created plus one task_created per card when a column is duplicated', async () => {
      const sourceColumnId = await makeColumn('Duplicate a column');
      const ids = [await makeTask(sourceColumnId, 1000), await makeTask(sourceColumnId, 2000)];
      const copyColumnId = newId();
      bulkColumns.push(copyColumnId);
      await settle();

      const from = clientB.events.length;
      const res = await ctx
        .request(userA.token)
        .post(`/api/columns/${sourceColumnId}/duplicate`, { id: copyColumnId, position: 30_000 });
      expect(res.status).toBe(201);
      const { tasks } = (await res.json()) as { tasks: Array<{ id: string }> };
      bulkTasks.push(...tasks.map((task) => task.id));

      const created = await clientB.waitForEvent(
        (e) => e.type === 'column_created' && e.data.id === copyColumnId,
        { from }
      );
      expect(created.project_id).toBe(projectId);
      for (const task of tasks) {
        await clientB.waitForEvent((e) => e.type === 'task_created' && e.data.id === task.id, {
          from,
        });
      }

      await settle();
      const since = clientB.events.slice(from);
      expect(since.filter((e) => e.type === 'task_created')).toHaveLength(ids.length);
      expect(since.filter((e) => e.type === 'column_created')).toHaveLength(1);
      expect(clientC.events).toEqual([]);
    });
  });

  it('delivers an uploaded image as an attachment, and its cover change', async () => {
    const imageId = newId();
    const uploadRes = await ctx
      .request(userA.token)
      .postBytes(uploadPath(taskId, { filename: 'pixel.png', id: imageId }), PNG_1X1);
    expect(uploadRes.status).toBe(201);

    const createdEvent = await clientB.waitForEvent(
      (e) => e.type === 'attachment_created' && e.data.id === imageId
    );
    expect(createdEvent.project_id).toBe(projectId);
    expect(createdEvent.data).toMatchObject({
      id: imageId,
      kind: 'image',
      image_url: `/api/images/${imageId}`,
      filename: 'pixel.png',
      content_type: 'image/png',
      task_id: taskId,
      attachment_count: 1,
    });

    const beforeCover = clientB.events.length;
    const coverRes = await ctx
      .request(userA.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: imageId });
    expect(coverRes.status).toBe(204);
    const coveredEvent = await clientB.waitForEvent(
      (e) => e.type === 'task_updated' && e.data.id === taskId,
      { from: beforeCover }
    );
    expect(coveredEvent.data).toMatchObject({ cover_image_url: `/api/images/${imageId}` });

    const deleteRes = await ctx.request(userA.token).delete(`/api/attachments/${imageId}`);
    expect(deleteRes.status).toBe(204);
    const deletedEvent = await clientB.waitForEvent((e) => e.type === 'attachment_deleted');
    expect(deletedEvent.project_id).toBe(projectId);
    expect(deletedEvent.data).toEqual({
      id: imageId,
      task_id: taskId,
      attachment_count: 0,
      actor_user_id: userA.id,
      cover_image_url: null,
    });
  });

  // attachment_deleted is the only event that reports a cover now, so it has to
  // name the one that survived rather than only the one that went.
  it('delivers the cover that survived a delete on attachment_deleted', async () => {
    const coverId = newId();
    const otherId = newId();
    for (const [id, filename] of [
      [coverId, 'cover.png'],
      [otherId, 'other.png'],
    ] as const) {
      const res = await ctx
        .request(userA.token)
        .postBytes(uploadPath(taskId, { filename: filename, id: id }), PNG_1X1);
      expect(res.status).toBe(201);
    }
    const coverRes = await ctx
      .request(userA.token)
      .put(`/api/tasks/${taskId}/cover`, { image_id: coverId });
    expect(coverRes.status).toBe(204);

    const from = clientB.events.length;
    const deleteRes = await ctx.request(userA.token).delete(`/api/attachments/${otherId}`);
    expect(deleteRes.status).toBe(204);

    const deletedEvent = await clientB.waitForEvent((e) => e.type === 'attachment_deleted', {
      from,
    });
    expect(deletedEvent.data).toEqual({
      id: otherId,
      task_id: taskId,
      attachment_count: 1,
      actor_user_id: userA.id,
      cover_image_url: `/api/images/${coverId}`,
    });
  });

  it('delivers comment_created, comment_updated, and comment_deleted with counts', async () => {
    const commentId = newId();
    const body = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'first' }] }],
    };
    const createRes = await ctx
      .request(userA.token)
      .post('/api/comments', { id: commentId, task_id: taskId, body });
    expect(createRes.status).toBe(201);

    const createdEvent = await clientB.waitForEvent(
      (e) => e.type === 'comment_created' && e.data.id === commentId
    );
    expect(createdEvent.project_id).toBe(projectId);
    expect(createdEvent.data).toMatchObject({
      id: commentId,
      task_id: taskId,
      user_id: userA.id,
      body,
      comment_count: 1,
    });

    const edited = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'second' }] }],
    };
    const patchRes = await ctx
      .request(userA.token)
      .patch(`/api/comments/${commentId}`, { body: edited });
    expect(patchRes.status).toBe(200);
    const updatedEvent = await clientB.waitForEvent((e) => e.type === 'comment_updated');
    expect(updatedEvent.project_id).toBe(projectId);
    expect(updatedEvent.data).toMatchObject({ id: commentId, task_id: taskId, body: edited });

    const deleteRes = await ctx.request(userA.token).delete(`/api/comments/${commentId}`);
    expect(deleteRes.status).toBe(204);
    const deletedEvent = await clientB.waitForEvent((e) => e.type === 'comment_deleted');
    expect(deletedEvent.project_id).toBe(projectId);
    expect(deletedEvent.data).toEqual({
      id: commentId,
      task_id: taskId,
      comment_count: 0,
      actor_user_id: userA.id,
    });

    await settle();
    expect(clientC.events).toEqual([]);
  });

  it('delivers task_deleted', async () => {
    expect((await ctx.request(userA.token).post(`/api/tasks/${task2Id}/archive`)).status).toBe(200);
    const res = await ctx.request(userA.token).delete(`/api/tasks/${task2Id}`);
    expect(res.status).toBe(204);
    const event = await clientA.waitForEvent(
      (e) => e.type === 'task_deleted' && e.data.id === task2Id
    );
    expect(event.project_id).toBe(projectId);
    expect(event.data).toEqual({ id: task2Id, actor_user_id: userA.id });
  });

  // The shared project's task counts are asserted further down, so anything
  // these tests add has to leave again.
  async function withTemporaryTasks(
    titles: string[],
    run: (ids: string[]) => Promise<void>
  ): Promise<void> {
    const ids: string[] = [];
    try {
      for (const [index, title] of titles.entries()) {
        const id = newId();
        const res = await ctx.request(userA.token).post('/api/tasks', {
          id,
          project_id: projectId,
          column_id: columnId,
          title,
          position: 10_000 + index * 1000,
        });
        expect(res.status).toBe(201);
        ids.push(id);
      }
      await run(ids);
    } finally {
      for (const id of ids) {
        await ctx.request(userA.token).post(`/api/tasks/${id}/archive`);
        await ctx.request(userA.token).delete(`/api/tasks/${id}`);
      }
    }
  }

  it('delivers task_archived with the archived shape and task_restored with the board shape', async () => {
    await withTemporaryTasks(['Archive me', 'Depends on it'], async ([blockerId, dependentId]) => {
      expect(
        (
          await ctx
            .request(userA.token)
            .post(`/api/tasks/${dependentId}/blockers`, { blocker_task_id: blockerId })
        ).status
      ).toBe(204);

      const archiveRes = await ctx.request(userA.token).post(`/api/tasks/${blockerId}/archive`);
      expect(archiveRes.status).toBe(200);
      const archivedEvent = await clientB.waitForEvent(
        (e) => e.type === 'task_archived' && e.data.id === blockerId
      );
      expect(archivedEvent.project_id).toBe(projectId);
      expect(archivedEvent.data).toMatchObject({ id: blockerId, title: 'Archive me' });
      expect(typeof archivedEvent.data.archived_at).toBe('string');

      // Delivery is an unawaited post-commit hook, so the blocker-add event has
      // to be allowed to land before the cursor for the restore fan-out is taken.
      await settle();
      const relationsBefore = clientB.events.length;

      const restoreRes = await ctx.request(userA.token).post(`/api/tasks/${blockerId}/restore`);
      expect(restoreRes.status).toBe(200);
      const restoredEvent = await clientB.waitForEvent(
        (e) => e.type === 'task_restored' && e.data.id === blockerId
      );
      expect(restoredEvent.data.archived_at).toBeUndefined();
      // Only this fan-out puts the restored id back in the dependent's
      // blocker_ids; nothing the client already holds names that direction.
      const relationsEvent = await clientB.waitForEvent(
        (e) => e.type === 'task_relations_set' && e.data.task_id === dependentId,
        { from: relationsBefore }
      );
      expect(relationsEvent.data.blocker_ids).toEqual([blockerId]);

      await settle();
      expect(clientB2.eventsOfType('task_archived')).toEqual([]);
      expect(clientB2.eventsOfType('task_restored')).toEqual([]);
    });
  });

  it('leaves an archived blocker out of a later task_relations_set', async () => {
    await withTemporaryTasks(
      ['Shelved blocker', 'Live blocker', 'Blocked by both'],
      async ([archivedBlockerId, liveBlockerId, blockedId]) => {
        for (const blocker of [archivedBlockerId, liveBlockerId]) {
          expect(
            (
              await ctx
                .request(userA.token)
                .post(`/api/tasks/${blockedId}/blockers`, { blocker_task_id: blocker })
            ).status
          ).toBe(204);
        }
        expect(
          (await ctx.request(userA.token).post(`/api/tasks/${archivedBlockerId}/archive`)).status
        ).toBe(200);

        await settle();
        const before = clientB.events.length;
        expect(
          (await ctx.request(userA.token).put(`/api/tasks/${blockedId}/labels`, { label_ids: [] }))
            .status
        ).toBe(204);

        const event = await clientB.waitForEvent(
          (e) => e.type === 'task_relations_set' && e.data.task_id === blockedId,
          { from: before }
        );
        expect(event.data.blocker_ids).toEqual([liveBlockerId]);
      }
    );
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
      members: [{ user_id: userB.id, role: 'editor' }],
      open_task_count: 1,
      done_task_count: 0,
    });
    await settle();
    expect(clientC.events).toEqual([]);
  });

  it('delivers a demotion to the demoted member as project_updated, not an eviction', async () => {
    const before = clientB2.events.length;
    const demote = await ctx.request(userA.token).put(`/api/projects/${projectId}/members`, {
      roles: [{ user_id: userB.id, role: 'viewer' }],
    });
    expect(demote.status).toBe(204);

    const event = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId,
      { from: before }
    );
    expect(event.data.members).toEqual([{ user_id: userB.id, role: 'viewer' }]);

    await settle();
    expect(clientB2.events.slice(before).filter((e) => e.type === 'project_deleted')).toEqual([]);

    const restore = await ctx.request(userA.token).put(`/api/projects/${projectId}/members`, {
      roles: [{ user_id: userB.id, role: 'editor' }],
    });
    expect(restore.status).toBe(204);
    // Drained here so the restore's broadcast cannot be picked up as the first
    // match by whichever test runs next.
    await settle();
  });

  it('delivers project_updated carrying is_public on publish and unpublish', async () => {
    const beforePublish = clientB2.events.length;
    const publishRes = await ctx
      .request(userA.token)
      .patch(`/api/projects/${projectId}`, { is_public: true });
    expect(publishRes.status).toBe(200);
    const published = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId,
      { from: beforePublish }
    );
    expect(published.data).toMatchObject({ id: projectId, is_public: true });

    const beforeUnpublish = clientB2.events.length;
    const unpublishRes = await ctx
      .request(userA.token)
      .patch(`/api/projects/${projectId}`, { is_public: false });
    expect(unpublishRes.status).toBe(200);
    const unpublished = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId,
      { from: beforeUnpublish }
    );
    expect(unpublished.data).toMatchObject({ id: projectId, is_public: false });
  });

  it('delivers project_updated carrying the accent colour, including its removal', async () => {
    const beforeSet = clientB2.events.length;
    expect(
      (await ctx.request(userA.token).patch(`/api/projects/${projectId}`, { color: 'sky' })).status
    ).toBe(200);
    const coloured = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId,
      { from: beforeSet }
    );
    expect(coloured.data).toMatchObject({ id: projectId, color: 'sky' });

    const beforeClear = clientB2.events.length;
    expect(
      (await ctx.request(userA.token).patch(`/api/projects/${projectId}`, { color: null })).status
    ).toBe(200);
    const cleared = await clientB2.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === projectId,
      { from: beforeClear }
    );
    expect(cleared.data).toMatchObject({ id: projectId, color: null });
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

  it('publishes no project_deleted when a member is refused the delete', async () => {
    const guardedProjectId = newId();
    const createRes = await ctx
      .request(userA.token)
      .post('/api/projects', { id: guardedProjectId, name: 'guarded project' });
    expect(createRes.status).toBe(201);
    const shareRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${guardedProjectId}/members`, { user_ids: [userB.id] });
    expect(shareRes.status).toBe(204);
    await settle();

    const refused = await ctx.request(userB.token).delete(`/api/projects/${guardedProjectId}`);
    expect(refused.status).toBe(403);

    await settle();
    for (const client of [clientA, clientB2]) {
      expect(
        client.eventsOfType('project_deleted').filter((e) => e.data.id === guardedProjectId)
      ).toEqual([]);
    }

    const cleanupRes = await ctx.request(userA.token).delete(`/api/projects/${guardedProjectId}`);
    expect(cleanupRes.status).toBe(204);
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

  it('delivers project_updated to both owners on an ownership transfer, evicting neither', async () => {
    const handoverProjectId = newId();
    const createRes = await ctx
      .request(userA.token)
      .post('/api/projects', { id: handoverProjectId, name: 'handover project' });
    expect(createRes.status).toBe(201);
    const addRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${handoverProjectId}/members`, { user_ids: [userB.id] });
    expect(addRes.status).toBe(204);
    await settle();

    const transferRes = await ctx
      .request(userA.token)
      .put(`/api/projects/${handoverProjectId}/owner`, { user_id: userB.id });
    expect(transferRes.status).toBe(200);

    for (const client of [clientA, clientB2]) {
      const event = await client.waitForEvent(
        (e) =>
          e.type === 'project_updated' &&
          e.data.id === handoverProjectId &&
          e.data.created_by === userB.id
      );
      expect(event.data.member_ids).toEqual([userA.id]);
    }

    await settle();
    for (const client of [clientA, clientB2]) {
      expect(
        client.events.some((e) => e.type === 'project_deleted' && e.data.id === handoverProjectId)
      ).toBe(false);
    }
    expect(clientC.events).toEqual([]);

    const cleanupRes = await ctx.request(userB.token).delete(`/api/projects/${handoverProjectId}`);
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
      sort_key: rankKey(3000),
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

  it('tells the remaining members when a member deletes their account', async () => {
    const host = await ctx.createUser('rt-host');
    const leaver = await ctx.createUser('rt-leaver');
    const sharedId = newId();
    const created = await ctx
      .request(host.token)
      .post('/api/projects', { id: sharedId, name: 'rt shared' });
    expect(created.status).toBe(201);
    const sharedColumnId = ((await created.json()) as { columns: Array<{ id: string }> }).columns[0]
      .id;
    await ctx.request(host.token).put(`/api/projects/${sharedId}/members`, {
      user_ids: [leaver.id],
    });
    const sharedTaskId = newId();
    await ctx.request(host.token).post('/api/tasks', {
      id: sharedTaskId,
      project_id: sharedId,
      column_id: sharedColumnId,
      title: 'shared work',
      sort_key: rankKey(1000),
    });
    await ctx
      .request(host.token)
      .put(`/api/tasks/${sharedTaskId}/assignees`, { user_ids: [leaver.id] });

    const hostClient = await connect(host.token);
    const leaverClient = await connect(leaver.token);
    hostClient.subscribe(sharedId);
    leaverClient.subscribe(sharedId);
    await waitFor(async () => projectSockets(sharedId).length === 2);
    const quietFrom = leaverClient.events.length;

    const res = await ctx
      .request(leaver.token)
      .delete('/api/auth/me', { password: leaver.password });
    expect(res.status).toBe(204);

    const updated = await hostClient.waitForEvent(
      (e) => e.type === 'project_updated' && e.data.id === sharedId
    );
    expect(updated.data).toMatchObject({ member_ids: [] });
    const relations = await hostClient.waitForEvent(
      (e) => e.type === 'task_relations_set' && e.data.task_id === sharedTaskId
    );
    expect(relations.data).toMatchObject({ assignee_ids: [] });

    await waitFor(async () => leaverClient.closeInfo !== null);
    expect(leaverClient.closeInfo).toEqual({ code: 4401, reason: 'Session revoked' });
    expect(leaverClient.events.length).toBe(quietFrom);
  });

  it('closes sockets with 4401 when the session is revoked', async () => {
    const userD = await ctx.createUser('rt-d');
    const clientD = await connect(userD.token);

    const list = await ctx.request(userD.token).get('/api/auth/sessions');
    expect(list.status).toBe(200);
    const { sessions } = (await list.json()) as { sessions: { id: string; is_current: boolean }[] };
    const current = sessions.find((entry) => entry.is_current);
    if (current === undefined) {
      throw new Error('no current session to revoke');
    }

    const res = await ctx.request(userD.token).delete(`/api/auth/sessions/${current.id}`);
    expect(res.status).toBe(204);

    await waitFor(async () => clientD.closeInfo !== null);
    expect(clientD.closeInfo).toEqual({ code: 4401, reason: 'Session revoked' });
  });
});
