import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { imageStorageKey, uploadPath, newId, rankKey } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import { BoardPayloadBody, deleteProjects, insertLabel, insertTaskImage } from './helpers';

// Everything the table below can be pointed at. The editor pass drives the same
// table against a fixture of its own per entry, so a mutation that succeeds
// never changes what a later one is aimed at.
interface Fixture {
  projectId: string;
  columnId: string;
  doneColumnId: string;
  taskId: string;
  blockerTaskId: string;
  labelId: string;
  imageId: string;
  commentId: string;
  checklistItemId: string;
  webhookId: string;
  deliveryId: string;
}

interface Mutation {
  name: string;
  send: (token: string) => Promise<Response>;
  // What an editor member gets from the same call, stated per entry rather than
  // as "anything but 403 or 404": a route that quietly became creator-only, or
  // one that starts answering a non-creator 404, then fails here.
  editor: number;
}

describe('Viewer enforcement across every mutating route', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  const storageKeys: string[] = [];
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let base: Fixture;

  async function createFixture(name: string): Promise<Fixture> {
    const projectId = newId();
    projectIds.push(projectId);
    const created = await ctx.request(owner.token).post('/api/projects', { id: projectId, name });
    expect(created.status).toBe(201);
    const board = (await created.json()) as BoardPayloadBody;
    const columnId = board.columns[0].id;
    const doneColumnId = board.columns[board.columns.length - 1].id;

    const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [editor.id, viewer.id],
      roles: [{ user_id: viewer.id, role: 'viewer' }],
    });
    expect(members.status).toBe(204);

    const taskId = newId();
    const blockerTaskId = newId();
    for (const [id, title] of [
      [taskId, 've task'],
      [blockerTaskId, 've blocker'],
    ]) {
      const res = await ctx.request(owner.token).post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: columnId,
        title,
        sort_key: rankKey(1000),
      });
      expect(res.status).toBe(201);
    }
    const blocker = await ctx
      .request(owner.token)
      .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerTaskId });
    expect(blocker.status).toBe(204);

    const labelId = await insertLabel({ projectId, name: 've label' });
    const { imageId, storageKey } = await insertTaskImage({ taskId });
    storageKeys.push(storageKey);
    await storage.put(storageKey, Buffer.from([1, 2, 3, 4]), 'image/png');

    const comment = await ctx.request(owner.token).post('/api/comments', {
      id: newId(),
      task_id: taskId,
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      },
    });
    expect(comment.status).toBe(201);
    const commentId = ((await comment.json()) as { id: string }).id;

    const checklistItemId = newId();
    const item = await ctx.request(owner.token).post('/api/checklist-items', {
      id: checklistItemId,
      task_id: taskId,
      text: 've checklist item',
      sort_key: rankKey(1000),
    });
    expect(item.status).toBe(201);

    const webhookId = newId();
    const webhook = await ctx.request(owner.token).post('/api/webhooks', {
      id: webhookId,
      project_id: projectId,
      url: 'https://example.com/hook',
    });
    expect(webhook.status).toBe(201);

    // A failed delivery to re-send: without one, redeliver answers 404 for
    // everybody and the editor pass could not tell a refusal from a miss.
    const deliveryId = newId();
    await db
      .insertInto('webhook_delivery')
      .values({
        id: deliveryId,
        webhook_id: webhookId,
        event_type: 'task_created',
        payload: JSON.stringify({ id: deliveryId, type: 'task_created', data: {} }),
        status: 'failed',
      })
      .execute();

    return {
      projectId,
      columnId,
      doneColumnId,
      taskId,
      blockerTaskId,
      labelId,
      imageId,
      commentId,
      checklistItemId,
      webhookId,
      deliveryId,
    };
  }

  beforeAll(async () => {
    owner = await ctx.createUser('ve-owner');
    editor = await ctx.createUser('ve-editor');
    viewer = await ctx.createUser('ve-viewer');
    outsider = await ctx.createUser('ve-outsider');

    base = await createFixture('ve project');
  });

  afterAll(async () => {
    const attachments = await db
      .selectFrom('task_attachment')
      .innerJoin('task', 'task.id', 'task_attachment.task_id')
      .select([
        'task_attachment.kind',
        'task_attachment.image_storage_key',
        'task_attachment.storage_key',
      ])
      .where('task.project_id', 'in', projectIds)
      .execute();
    const stored = attachments
      .map((row) =>
        row.kind === 'image' ? imageStorageKey(row.image_storage_key) : row.storage_key
      )
      .filter((key): key is string => key !== null);
    await deleteProjects(projectIds);
    await ctx.cleanup();
    await Promise.all([...new Set([...storageKeys, ...stored])].map((key) => storage.delete(key)));
  });

  // Every project-scoped mutation. A viewer must get 403 on all of them and an
  // outsider 404, so the new status can never be used to probe for existence,
  // and an editor member must be able to drive every one of them.
  function mutations(current: () => Fixture): Mutation[] {
    const tiptap = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'edited' }] }],
    };
    return [
      {
        name: 'PATCH /api/projects/:id',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/projects/${current().projectId}`, { name: 'renamed' }),
      },
      {
        name: 'PATCH /api/projects/:id (publish)',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/projects/${current().projectId}`, { is_public: true }),
      },
      {
        name: 'PATCH /api/projects/:id (color)',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/projects/${current().projectId}`, { color: 'violet' }),
      },
      {
        name: 'DELETE /api/projects/:id',
        // Owner-only: an editor member is refused the same way a viewer is.
        editor: 403,
        send: (t) => ctx.request(t).delete(`/api/projects/${current().projectId}`),
      },
      {
        name: 'PUT /api/projects/:id/owner',
        // Owner-only, as above.
        editor: 403,
        send: (t) =>
          ctx.request(t).put(`/api/projects/${current().projectId}/owner`, { user_id: editor.id }),
      },
      {
        name: 'POST /api/projects/:id/members/by-email',
        editor: 200,
        send: (t) =>
          ctx.request(t).post(`/api/projects/${current().projectId}/members/by-email`, {
            email: outsider.email,
          }),
      },
      {
        name: 'POST /api/tasks',
        editor: 201,
        send: (t) =>
          ctx.request(t).post('/api/tasks', {
            id: newId(),
            project_id: current().projectId,
            column_id: current().columnId,
            title: 'nope',
            sort_key: rankKey(5000),
          }),
      },
      {
        name: 'POST /api/tasks/batch',
        editor: 201,
        send: (t) =>
          ctx.request(t).post('/api/tasks/batch', {
            project_id: current().projectId,
            column_id: current().columnId,
            tasks: [{ id: newId(), title: 'nope', sort_key: rankKey(6000) }],
          }),
      },
      {
        name: 'POST /api/tasks/:id/duplicate',
        editor: 201,
        send: (t) =>
          ctx.request(t).post(`/api/tasks/${current().taskId}/duplicate`, {
            id: newId(),
            sort_key: rankKey(7000),
          }),
      },
      {
        name: 'PATCH /api/tasks/:id',
        editor: 200,
        send: (t) => ctx.request(t).patch(`/api/tasks/${current().taskId}`, { title: 'renamed' }),
      },
      {
        name: 'PATCH /api/tasks/:id (move)',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/tasks/${current().taskId}`, {
            column_id: current().doneColumnId,
            sort_key: rankKey(9000),
          }),
      },
      {
        name: 'PATCH /api/tasks/:id (due date)',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/tasks/${current().taskId}`, { due_date: '2030-01-01' }),
      },
      {
        name: 'PATCH /api/tasks/:id (description)',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/tasks/${current().taskId}`, { description: tiptap }),
      },
      {
        name: 'DELETE /api/tasks/:id',
        // Deletion is only reachable from the archive, so a live card is 422 —
        // which is still the handler acting rather than refusing the caller.
        editor: 422,
        send: (t) => ctx.request(t).delete(`/api/tasks/${current().taskId}`),
      },
      {
        name: 'POST /api/tasks/:id/archive',
        editor: 200,
        send: (t) => ctx.request(t).post(`/api/tasks/${current().taskId}/archive`),
      },
      {
        name: 'POST /api/tasks/:id/restore',
        editor: 200,
        send: (t) => ctx.request(t).post(`/api/tasks/${current().taskId}/restore`),
      },
      {
        name: 'PUT /api/tasks/:id/labels',
        editor: 204,
        send: (t) =>
          ctx
            .request(t)
            .put(`/api/tasks/${current().taskId}/labels`, { label_ids: [current().labelId] }),
      },
      {
        name: 'PUT /api/tasks/:id/assignees',
        editor: 204,
        send: (t) =>
          ctx.request(t).put(`/api/tasks/${current().taskId}/assignees`, { user_ids: [viewer.id] }),
      },
      {
        name: 'PUT /api/tasks/:id/cover',
        editor: 204,
        send: (t) =>
          ctx
            .request(t)
            .put(`/api/tasks/${current().taskId}/cover`, { image_id: current().imageId }),
      },
      {
        name: 'POST /api/tasks/:id/blockers',
        editor: 204,
        send: (t) =>
          ctx.request(t).post(`/api/tasks/${current().taskId}/blockers`, {
            blocker_task_id: current().blockerTaskId,
          }),
      },
      {
        name: 'DELETE /api/tasks/:id/blockers/:blockerTaskId',
        editor: 204,
        send: (t) =>
          ctx
            .request(t)
            .delete(`/api/tasks/${current().taskId}/blockers/${current().blockerTaskId}`),
      },
      {
        name: 'POST /api/attachments/files',
        editor: 201,
        send: (t) => {
          return ctx
            .request(t)
            .postBytes(uploadPath(current().taskId, { filename: 'x.png' }), Buffer.from([1, 2, 3]));
        },
      },
      {
        name: 'DELETE /api/images/:id',
        editor: 204,
        send: (t) => ctx.request(t).delete(`/api/attachments/${current().imageId}`),
      },
      {
        name: 'POST /api/checklist-items',
        editor: 201,
        send: (t) =>
          ctx.request(t).post('/api/checklist-items', {
            id: newId(),
            task_id: current().taskId,
            text: 'nope',
            sort_key: rankKey(1000),
          }),
      },
      {
        name: 'PATCH /api/checklist-items/:id',
        editor: 200,
        send: (t) =>
          ctx
            .request(t)
            .patch(`/api/checklist-items/${current().checklistItemId}`, { checked: true }),
      },
      {
        name: 'DELETE /api/checklist-items/:id',
        editor: 204,
        send: (t) => ctx.request(t).delete(`/api/checklist-items/${current().checklistItemId}`),
      },
      {
        name: 'POST /api/checklist-items/:id/promote',
        editor: 201,
        send: (t) =>
          ctx.request(t).post(`/api/checklist-items/${current().checklistItemId}/promote`, {
            id: newId(),
            sort_key: rankKey(9900),
          }),
      },
      {
        name: 'POST /api/columns',
        editor: 201,
        send: (t) =>
          ctx.request(t).post('/api/columns', {
            id: newId(),
            project_id: current().projectId,
            name: 'nope',
            sort_key: rankKey(9000),
          }),
      },
      {
        name: 'POST /api/columns/:id/duplicate',
        editor: 201,
        send: (t) =>
          ctx.request(t).post(`/api/columns/${current().columnId}/duplicate`, {
            id: newId(),
            sort_key: rankKey(9500),
          }),
      },
      {
        name: 'PATCH /api/columns/:id',
        editor: 200,
        send: (t) =>
          ctx.request(t).patch(`/api/columns/${current().columnId}`, { name: 'renamed' }),
      },
      {
        name: 'DELETE /api/columns/:id',
        // 200 rather than 204: the column holds the fixture's two cards, which
        // move to the target.
        editor: 200,
        send: (t) =>
          ctx
            .request(t)
            .delete(`/api/columns/${current().columnId}?move_tasks_to=${current().doneColumnId}`),
      },
      {
        name: 'POST /api/columns/:id/move-tasks',
        editor: 200,
        send: (t) =>
          ctx.request(t).post(`/api/columns/${current().columnId}/move-tasks`, {
            target_column_id: current().doneColumnId,
          }),
      },
      {
        name: 'POST /api/columns/:id/reorder',
        editor: 200,
        send: (t) =>
          ctx.request(t).post(`/api/columns/${current().columnId}/reorder`, {
            task_ids: [current().blockerTaskId, current().taskId],
          }),
      },
      {
        name: 'POST /api/columns/:id/archive-tasks',
        editor: 200,
        send: (t) => ctx.request(t).post(`/api/columns/${current().columnId}/archive-tasks`),
      },
      {
        name: 'POST /api/labels',
        editor: 201,
        send: (t) =>
          ctx.request(t).post('/api/labels', {
            id: newId(),
            project_id: current().projectId,
            name: 'nope',
            color: '#00ff00',
          }),
      },
      {
        name: 'PATCH /api/labels/:id',
        editor: 200,
        send: (t) => ctx.request(t).patch(`/api/labels/${current().labelId}`, { name: 'renamed' }),
      },
      {
        name: 'DELETE /api/labels/:id',
        editor: 204,
        send: (t) => ctx.request(t).delete(`/api/labels/${current().labelId}`),
      },
      {
        name: 'POST /api/webhooks',
        editor: 201,
        send: (t) =>
          ctx.request(t).post('/api/webhooks', {
            id: newId(),
            project_id: current().projectId,
            url: 'https://example.com/other',
          }),
      },
      {
        name: 'PATCH /api/webhooks/:id',
        editor: 200,
        send: (t) =>
          ctx
            .request(t)
            .patch(`/api/webhooks/${current().webhookId}`, { url: 'https://example.com/moved' }),
      },
      {
        name: 'DELETE /api/webhooks/:id',
        editor: 204,
        send: (t) => ctx.request(t).delete(`/api/webhooks/${current().webhookId}`),
      },
      {
        name: 'POST /api/webhooks/:id/rotate-secret',
        editor: 200,
        send: (t) => ctx.request(t).post(`/api/webhooks/${current().webhookId}/rotate-secret`),
      },
      {
        name: 'POST /api/webhooks/:id/deliveries/:deliveryId/redeliver',
        editor: 204,
        send: (t) =>
          ctx
            .request(t)
            .post(
              `/api/webhooks/${current().webhookId}/deliveries/${current().deliveryId}/redeliver`
            ),
      },
    ];
  }

  describe('a viewer', () => {
    for (const mutation of mutations(() => base)) {
      it(`is refused 403 by ${mutation.name}`, async () => {
        const res = await mutation.send(viewer.token);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: 'Read-only access to this project' });
      });
    }

    it('leaves every row it tried to change intact', async () => {
      const project = await db
        .selectFrom('project')
        .select(['name', 'is_public', 'color'])
        .where('id', '=', base.projectId)
        .executeTakeFirst();
      expect(project).toEqual({ name: 've project', is_public: false, color: null });

      const task = await db
        .selectFrom('task')
        .select(['title', 'column_id', 'archived_at', 'due_date', 'description'])
        .where('id', '=', base.taskId)
        .executeTakeFirst();
      expect(task).toMatchObject({
        title: 've task',
        column_id: base.columnId,
        archived_at: null,
        due_date: null,
        description: null,
      });

      const columns = await db
        .selectFrom('board_column')
        .select('id')
        .where('project_id', '=', base.projectId)
        .execute();
      expect(columns.map((row) => row.id)).toContain(base.columnId);

      const label = await db
        .selectFrom('label')
        .select('name')
        .where('id', '=', base.labelId)
        .executeTakeFirst();
      expect(label).toEqual({ name: 've label' });

      const image = await db
        .selectFrom('task_attachment')
        .select(['id', 'is_cover'])
        .where('id', '=', base.imageId)
        .where('kind', '=', 'image')
        .executeTakeFirst();
      expect(image).toEqual({ id: base.imageId, is_cover: false });

      const webhooks = await db
        .selectFrom('project_webhook')
        .select('url')
        .where('project_id', '=', base.projectId)
        .execute();
      expect(webhooks).toEqual([{ url: 'https://example.com/hook' }]);

      const items = await db
        .selectFrom('checklist_item')
        .select(['id', 'text', 'checked'])
        .where('task_id', '=', base.taskId)
        .execute();
      expect(items).toEqual([
        { id: base.checklistItemId, text: 've checklist item', checked: false },
      ]);

      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', base.taskId)
        .execute();
      expect(assignees).toEqual([]);

      const members = await db
        .selectFrom('project_member')
        .select('user_id')
        .where('project_id', '=', base.projectId)
        .execute();
      expect(members.map((row) => row.user_id).sort()).toEqual([editor.id, viewer.id].sort());
    });
  });

  describe('an outsider', () => {
    for (const mutation of mutations(() => base)) {
      it(`gets 404, never 403, from ${mutation.name}`, async () => {
        const res = await mutation.send(outsider.token);
        expect(res.status).toBe(404);
      });
    }
  });

  describe('what a viewer keeps', () => {
    it('reads the board, the task, the archive, the activity and the export', async () => {
      const request = ctx.request(viewer.token);
      for (const path of [
        `/api/projects/${base.projectId}`,
        `/api/projects/${base.projectId}/archived-tasks`,
        `/api/projects/${base.projectId}/export?format=json`,
        `/api/tasks/${base.taskId}`,
        `/api/tasks/${base.taskId}/activity`,
        `/api/users?project_id=${base.projectId}`,
        `/api/webhooks?project_id=${base.projectId}`,
      ]) {
        expect((await request.get(path)).status).toBe(200);
      }
    });

    it('sees the project in their list and in search', async () => {
      const list = await ctx.request(viewer.token).get('/api/projects');
      expect(list.status).toBe(200);
      const item = ((await list.json()) as { projects: { id: string }[] }).projects.find(
        (p) => p.id === base.projectId
      );
      expect(item).toBeDefined();

      const search = await ctx.request(viewer.token).get('/api/search?q=task');
      expect(search.status).toBe(200);
      const results = ((await search.json()) as { results: { task_id: string }[] }).results;
      expect(results.map((row) => row.task_id)).toContain(base.taskId);
    });

    it('does not leak the project into an outsider’s search', async () => {
      const search = await ctx.request(outsider.token).get('/api/search?q=task');
      expect(search.status).toBe(200);
      const results = ((await search.json()) as { results: { project_id: string }[] }).results;
      expect(results.map((row) => row.project_id)).not.toContain(base.projectId);
    });

    it('orders their own project list', async () => {
      const res = await ctx
        .request(viewer.token)
        .put(`/api/projects/${base.projectId}/position`, { sort_key: rankKey(500) });
      expect(res.status).toBe(204);
    });

    it('copies a board they can only read into a project of their own', async () => {
      const id = newId();
      projectIds.push(id);
      const res = await ctx
        .request(viewer.token)
        .post('/api/projects', { id, name: 've copy', source_project_id: base.projectId });
      expect(res.status).toBe(201);
      const copy = (await res.json()) as BoardPayloadBody;
      expect(copy.project.created_by).toBe(viewer.id);
      expect(copy.project.members).toEqual([]);
    });

    it('comments, and edits and deletes their own comment', async () => {
      const body = {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a question' }] }],
      };
      const id = newId();
      const created = await ctx
        .request(viewer.token)
        .post('/api/comments', { id, task_id: base.taskId, body });
      expect(created.status).toBe(201);

      const edited = await ctx.request(viewer.token).patch(`/api/comments/${id}`, { body });
      expect(edited.status).toBe(200);

      const removed = await ctx.request(viewer.token).delete(`/api/comments/${id}`);
      expect(removed.status).toBe(204);
    });

    it('cannot touch another member’s comment, which reads as 404', async () => {
      const res = await ctx.request(viewer.token).delete(`/api/comments/${base.commentId}`);
      expect(res.status).toBe(404);
    });

    it('can be assigned a task by an editor even though they cannot move it', async () => {
      const assign = await ctx
        .request(owner.token)
        .put(`/api/tasks/${base.taskId}/assignees`, { user_ids: [viewer.id] });
      expect(assign.status).toBe(204);

      const mine = await ctx.request(viewer.token).get('/api/my-tasks');
      expect(mine.status).toBe(200);
      const tasks = ((await mine.json()) as { tasks: { id: string }[] }).tasks;
      expect(tasks.map((task) => task.id)).toContain(base.taskId);

      const move = await ctx.request(viewer.token).patch(`/api/tasks/${base.taskId}`, {
        column_id: base.doneColumnId,
        sort_key: rankKey(1500),
      });
      expect(move.status).toBe(403);

      await ctx.request(owner.token).put(`/api/tasks/${base.taskId}/assignees`, { user_ids: [] });
    });
  });

  describe('a public board', () => {
    it('is published and unpublished by editors only, and stays anonymous to read', async () => {
      const byViewer = await ctx
        .request(viewer.token)
        .patch(`/api/projects/${base.projectId}`, { is_public: true });
      expect(byViewer.status).toBe(403);

      const published = await ctx
        .request(editor.token)
        .patch(`/api/projects/${base.projectId}`, { is_public: true });
      expect(published.status).toBe(200);

      const anonymous = await ctx.request().get(`/api/public/projects/${base.projectId}/board`);
      expect(anonymous.status).toBe(200);

      const unpublishedByViewer = await ctx
        .request(viewer.token)
        .patch(`/api/projects/${base.projectId}`, { is_public: false });
      expect(unpublishedByViewer.status).toBe(403);

      const unpublished = await ctx
        .request(editor.token)
        .patch(`/api/projects/${base.projectId}`, { is_public: false });
      expect(unpublished.status).toBe(200);
      expect((await ctx.request().get(`/api/public/projects/${base.projectId}/board`)).status).toBe(
        404
      );
    });
  });

  // The same table a third time. Hand-picking a few routes here is what let
  // "editor member" go untested for whole route families — a creator-only gate
  // added to the webhook, checklist or attachment routes refuses a member of a
  // shared board while both describes above stay green.
  describe('an editor member', () => {
    let own: Fixture;

    for (const mutation of mutations(() => own)) {
      it(`still performs ${mutation.name}`, async () => {
        own = await createFixture('ve editor project');
        const res = await mutation.send(editor.token);
        expect(res.status).toBe(mutation.editor);
        if (mutation.editor === 403) {
          // Refused for owning the project, not for being read-only: an editor
          // demoted by a regression would answer with the viewer's message.
          expect(await res.json()).toEqual({ error: expect.stringContaining('owner') });
        }
      });
    }
  });
});
