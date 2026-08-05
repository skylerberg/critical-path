import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import { BoardPayloadBody, deleteProjects, insertLabel, insertTaskImage } from './helpers';

interface Mutation {
  name: string;
  send: (token: string) => Promise<Response>;
}

describe('Viewer enforcement across every mutating route', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  const storageKeys: string[] = [];
  let owner: TestUser;
  let editor: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;

  let board: BoardPayloadBody;
  let projectId: string;
  let columnId: string;
  let doneColumnId: string;
  let taskId: string;
  let blockerTaskId: string;
  let labelId: string;
  let imageId: string;
  let commentId: string;
  let checklistItemId: string;
  let webhookId: string;

  beforeAll(async () => {
    owner = await ctx.createUser('ve-owner');
    editor = await ctx.createUser('ve-editor');
    viewer = await ctx.createUser('ve-viewer');
    outsider = await ctx.createUser('ve-outsider');

    projectId = newId();
    projectIds.push(projectId);
    const created = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 've project' });
    expect(created.status).toBe(201);
    board = (await created.json()) as BoardPayloadBody;
    columnId = board.columns[0].id;
    doneColumnId = board.columns[board.columns.length - 1].id;

    const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [editor.id, viewer.id],
      roles: [{ user_id: viewer.id, role: 'viewer' }],
    });
    expect(members.status).toBe(204);

    taskId = newId();
    blockerTaskId = newId();
    for (const [id, title] of [
      [taskId, 've task'],
      [blockerTaskId, 've blocker'],
    ]) {
      const res = await ctx.request(owner.token).post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: columnId,
        title,
        position: 1000,
      });
      expect(res.status).toBe(201);
    }
    const blocker = await ctx
      .request(owner.token)
      .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerTaskId });
    expect(blocker.status).toBe(204);

    labelId = await insertLabel({ projectId, name: 've label' });
    let storageKey: string;
    ({ imageId, storageKey } = await insertTaskImage({ taskId }));
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
    commentId = ((await comment.json()) as { id: string }).id;

    checklistItemId = newId();
    const item = await ctx.request(owner.token).post('/api/checklist-items', {
      id: checklistItemId,
      task_id: taskId,
      text: 've checklist item',
      position: 1000,
    });
    expect(item.status).toBe(201);

    webhookId = newId();
    const webhook = await ctx.request(owner.token).post('/api/webhooks', {
      id: webhookId,
      project_id: projectId,
      url: 'https://example.com/hook',
    });
    expect(webhook.status).toBe(201);
  });

  afterAll(async () => {
    const copied = await db
      .selectFrom('task_attachment')
      .innerJoin('task', 'task.id', 'task_attachment.task_id')
      .select('task_attachment.image_storage_key as storage_key')
      .where('task_attachment.kind', '=', 'image')
      .where('task.project_id', 'in', projectIds)
      .execute();
    await deleteProjects(projectIds);
    await ctx.cleanup();
    await Promise.all(
      [...new Set([...storageKeys, ...copied.map((row) => row.storage_key)])].map((key) =>
        storage.delete(key)
      )
    );
  });

  // Every project-scoped mutation. A viewer must get 403 on all of them and an
  // outsider 404, so the new status can never be used to probe for existence.
  function mutations(): Mutation[] {
    const tiptap = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'edited' }] }],
    };
    return [
      {
        name: 'PATCH /api/projects/:id',
        send: (t) => ctx.request(t).patch(`/api/projects/${projectId}`, { name: 'renamed' }),
      },
      {
        name: 'PATCH /api/projects/:id (publish)',
        send: (t) => ctx.request(t).patch(`/api/projects/${projectId}`, { is_public: true }),
      },
      {
        name: 'PATCH /api/projects/:id (colour)',
        send: (t) => ctx.request(t).patch(`/api/projects/${projectId}`, { color: 'violet' }),
      },
      {
        name: 'DELETE /api/projects/:id',
        send: (t) => ctx.request(t).delete(`/api/projects/${projectId}`),
      },
      {
        name: 'PUT /api/projects/:id/owner',
        send: (t) => ctx.request(t).put(`/api/projects/${projectId}/owner`, { user_id: editor.id }),
      },
      {
        name: 'POST /api/projects/:id/members/by-email',
        send: (t) =>
          ctx
            .request(t)
            .post(`/api/projects/${projectId}/members/by-email`, { email: outsider.email }),
      },
      {
        name: 'POST /api/tasks',
        send: (t) =>
          ctx.request(t).post('/api/tasks', {
            id: newId(),
            project_id: projectId,
            column_id: columnId,
            title: 'nope',
            position: 5000,
          }),
      },
      {
        name: 'POST /api/tasks/batch',
        send: (t) =>
          ctx.request(t).post('/api/tasks/batch', {
            project_id: projectId,
            column_id: columnId,
            tasks: [{ id: newId(), title: 'nope', position: 6000 }],
          }),
      },
      {
        name: 'POST /api/tasks/:id/duplicate',
        send: (t) =>
          ctx.request(t).post(`/api/tasks/${taskId}/duplicate`, { id: newId(), position: 7000 }),
      },
      {
        name: 'PATCH /api/tasks/:id',
        send: (t) => ctx.request(t).patch(`/api/tasks/${taskId}`, { title: 'renamed' }),
      },
      {
        name: 'PATCH /api/tasks/:id (move)',
        send: (t) =>
          ctx.request(t).patch(`/api/tasks/${taskId}`, { column_id: doneColumnId, position: 9000 }),
      },
      {
        name: 'PATCH /api/tasks/:id (due date)',
        send: (t) => ctx.request(t).patch(`/api/tasks/${taskId}`, { due_date: '2030-01-01' }),
      },
      {
        name: 'PATCH /api/tasks/:id (description)',
        send: (t) => ctx.request(t).patch(`/api/tasks/${taskId}`, { description: tiptap }),
      },
      { name: 'DELETE /api/tasks/:id', send: (t) => ctx.request(t).delete(`/api/tasks/${taskId}`) },
      {
        name: 'POST /api/tasks/:id/archive',
        send: (t) => ctx.request(t).post(`/api/tasks/${taskId}/archive`),
      },
      {
        name: 'POST /api/tasks/:id/restore',
        send: (t) => ctx.request(t).post(`/api/tasks/${taskId}/restore`),
      },
      {
        name: 'PUT /api/tasks/:id/labels',
        send: (t) => ctx.request(t).put(`/api/tasks/${taskId}/labels`, { label_ids: [labelId] }),
      },
      {
        name: 'PUT /api/tasks/:id/assignees',
        send: (t) =>
          ctx.request(t).put(`/api/tasks/${taskId}/assignees`, { user_ids: [viewer.id] }),
      },
      {
        name: 'PUT /api/tasks/:id/cover',
        send: (t) => ctx.request(t).put(`/api/tasks/${taskId}/cover`, { image_id: imageId }),
      },
      {
        name: 'POST /api/tasks/:id/blockers',
        send: (t) =>
          ctx.request(t).post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerTaskId }),
      },
      {
        name: 'DELETE /api/tasks/:id/blockers/:blockerTaskId',
        send: (t) => ctx.request(t).delete(`/api/tasks/${taskId}/blockers/${blockerTaskId}`),
      },
      {
        name: 'POST /api/tasks/:id/images',
        send: (t) => {
          const form = new FormData();
          form.append('file', new Blob([new Uint8Array([1, 2, 3])]), 'x.png');
          return ctx.request(t).postMultipart(`/api/tasks/${taskId}/images`, form);
        },
      },
      {
        name: 'DELETE /api/images/:id',
        send: (t) => ctx.request(t).delete(`/api/images/${imageId}`),
      },
      {
        name: 'POST /api/checklist-items',
        send: (t) =>
          ctx.request(t).post('/api/checklist-items', {
            id: newId(),
            task_id: taskId,
            text: 'nope',
            position: 1000,
          }),
      },
      {
        name: 'PATCH /api/checklist-items/:id',
        send: (t) =>
          ctx.request(t).patch(`/api/checklist-items/${checklistItemId}`, { checked: true }),
      },
      {
        name: 'DELETE /api/checklist-items/:id',
        send: (t) => ctx.request(t).delete(`/api/checklist-items/${checklistItemId}`),
      },
      {
        name: 'POST /api/checklist-items/:id/promote',
        send: (t) =>
          ctx.request(t).post(`/api/checklist-items/${checklistItemId}/promote`, {
            id: newId(),
            position: 9900,
          }),
      },
      {
        name: 'POST /api/columns',
        send: (t) =>
          ctx.request(t).post('/api/columns', {
            id: newId(),
            project_id: projectId,
            name: 'nope',
            position: 9000,
          }),
      },
      {
        name: 'POST /api/columns/:id/duplicate',
        send: (t) =>
          ctx
            .request(t)
            .post(`/api/columns/${columnId}/duplicate`, { id: newId(), position: 9500 }),
      },
      {
        name: 'PATCH /api/columns/:id',
        send: (t) => ctx.request(t).patch(`/api/columns/${columnId}`, { name: 'renamed' }),
      },
      {
        name: 'DELETE /api/columns/:id',
        send: (t) =>
          ctx.request(t).delete(`/api/columns/${columnId}?move_tasks_to=${doneColumnId}`),
      },
      {
        name: 'POST /api/columns/:id/move-tasks',
        send: (t) =>
          ctx
            .request(t)
            .post(`/api/columns/${columnId}/move-tasks`, { target_column_id: doneColumnId }),
      },
      {
        name: 'POST /api/columns/:id/archive-tasks',
        send: (t) => ctx.request(t).post(`/api/columns/${columnId}/archive-tasks`),
      },
      {
        name: 'POST /api/labels',
        send: (t) =>
          ctx.request(t).post('/api/labels', {
            id: newId(),
            project_id: projectId,
            name: 'nope',
            color: '#00ff00',
          }),
      },
      {
        name: 'PATCH /api/labels/:id',
        send: (t) => ctx.request(t).patch(`/api/labels/${labelId}`, { name: 'renamed' }),
      },
      {
        name: 'DELETE /api/labels/:id',
        send: (t) => ctx.request(t).delete(`/api/labels/${labelId}`),
      },
      {
        name: 'POST /api/webhooks',
        send: (t) =>
          ctx.request(t).post('/api/webhooks', {
            id: newId(),
            project_id: projectId,
            url: 'https://example.com/other',
          }),
      },
      {
        name: 'PATCH /api/webhooks/:id',
        send: (t) =>
          ctx.request(t).patch(`/api/webhooks/${webhookId}`, { url: 'https://example.com/moved' }),
      },
      {
        name: 'DELETE /api/webhooks/:id',
        send: (t) => ctx.request(t).delete(`/api/webhooks/${webhookId}`),
      },
      {
        name: 'POST /api/webhooks/:id/rotate-secret',
        send: (t) => ctx.request(t).post(`/api/webhooks/${webhookId}/rotate-secret`),
      },
      {
        name: 'POST /api/webhooks/:id/deliveries/:deliveryId/redeliver',
        send: (t) =>
          ctx.request(t).post(`/api/webhooks/${webhookId}/deliveries/${newId()}/redeliver`),
      },
    ];
  }

  describe('a viewer', () => {
    for (const mutation of mutations()) {
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
        .where('id', '=', projectId)
        .executeTakeFirst();
      expect(project).toEqual({ name: 've project', is_public: false, color: null });

      const task = await db
        .selectFrom('task')
        .select(['title', 'column_id', 'archived_at', 'due_date', 'description'])
        .where('id', '=', taskId)
        .executeTakeFirst();
      expect(task).toMatchObject({
        title: 've task',
        column_id: columnId,
        archived_at: null,
        due_date: null,
        description: null,
      });

      const columns = await db
        .selectFrom('board_column')
        .select('id')
        .where('project_id', '=', projectId)
        .execute();
      expect(columns.map((row) => row.id)).toContain(columnId);

      const label = await db
        .selectFrom('label')
        .select('name')
        .where('id', '=', labelId)
        .executeTakeFirst();
      expect(label).toEqual({ name: 've label' });

      const image = await db
        .selectFrom('task_attachment')
        .select(['id', 'is_cover'])
        .where('id', '=', imageId)
        .where('kind', '=', 'image')
        .executeTakeFirst();
      expect(image).toEqual({ id: imageId, is_cover: false });

      const webhooks = await db
        .selectFrom('project_webhook')
        .select('url')
        .where('project_id', '=', projectId)
        .execute();
      expect(webhooks).toEqual([{ url: 'https://example.com/hook' }]);

      const items = await db
        .selectFrom('checklist_item')
        .select(['id', 'text', 'checked'])
        .where('task_id', '=', taskId)
        .execute();
      expect(items).toEqual([{ id: checklistItemId, text: 've checklist item', checked: false }]);

      const assignees = await db
        .selectFrom('task_assignee')
        .select('user_id')
        .where('task_id', '=', taskId)
        .execute();
      expect(assignees).toEqual([]);

      const members = await db
        .selectFrom('project_member')
        .select('user_id')
        .where('project_id', '=', projectId)
        .execute();
      expect(members.map((row) => row.user_id).sort()).toEqual([editor.id, viewer.id].sort());
    });
  });

  describe('an outsider', () => {
    for (const mutation of mutations()) {
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
        `/api/projects/${projectId}`,
        `/api/projects/${projectId}/archived-tasks`,
        `/api/projects/${projectId}/export?format=json`,
        `/api/tasks/${taskId}`,
        `/api/tasks/${taskId}/activity`,
        `/api/users?project_id=${projectId}`,
        `/api/webhooks?project_id=${projectId}`,
      ]) {
        expect((await request.get(path)).status).toBe(200);
      }
    });

    it('sees the project in their list and in search', async () => {
      const list = await ctx.request(viewer.token).get('/api/projects');
      expect(list.status).toBe(200);
      const item = ((await list.json()) as { projects: { id: string }[] }).projects.find(
        (p) => p.id === projectId
      );
      expect(item).toBeDefined();

      const search = await ctx.request(viewer.token).get('/api/search?q=task');
      expect(search.status).toBe(200);
      const results = ((await search.json()) as { results: { task_id: string }[] }).results;
      expect(results.map((row) => row.task_id)).toContain(taskId);
    });

    it('does not leak the project into an outsider’s search', async () => {
      const search = await ctx.request(outsider.token).get('/api/search?q=task');
      expect(search.status).toBe(200);
      const results = ((await search.json()) as { results: { project_id: string }[] }).results;
      expect(results.map((row) => row.project_id)).not.toContain(projectId);
    });

    it('orders their own project list', async () => {
      const res = await ctx
        .request(viewer.token)
        .put(`/api/projects/${projectId}/position`, { position: 500 });
      expect(res.status).toBe(204);
    });

    it('copies a board they can only read into a project of their own', async () => {
      const id = newId();
      projectIds.push(id);
      const res = await ctx
        .request(viewer.token)
        .post('/api/projects', { id, name: 've copy', source_project_id: projectId });
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
        .post('/api/comments', { id, task_id: taskId, body });
      expect(created.status).toBe(201);

      const edited = await ctx.request(viewer.token).patch(`/api/comments/${id}`, { body });
      expect(edited.status).toBe(200);

      const removed = await ctx.request(viewer.token).delete(`/api/comments/${id}`);
      expect(removed.status).toBe(204);
    });

    it('cannot touch another member’s comment, which reads as 404', async () => {
      const res = await ctx.request(viewer.token).delete(`/api/comments/${commentId}`);
      expect(res.status).toBe(404);
    });

    it('can be assigned a task by an editor even though they cannot move it', async () => {
      const assign = await ctx
        .request(owner.token)
        .put(`/api/tasks/${taskId}/assignees`, { user_ids: [viewer.id] });
      expect(assign.status).toBe(204);

      const mine = await ctx.request(viewer.token).get('/api/my-tasks');
      expect(mine.status).toBe(200);
      const tasks = ((await mine.json()) as { tasks: { id: string }[] }).tasks;
      expect(tasks.map((task) => task.id)).toContain(taskId);

      const move = await ctx
        .request(viewer.token)
        .patch(`/api/tasks/${taskId}`, { column_id: doneColumnId, position: 1500 });
      expect(move.status).toBe(403);

      await ctx.request(owner.token).put(`/api/tasks/${taskId}/assignees`, { user_ids: [] });
    });
  });

  describe('a public board', () => {
    it('is published and unpublished by editors only, and stays anonymous to read', async () => {
      const byViewer = await ctx
        .request(viewer.token)
        .patch(`/api/projects/${projectId}`, { is_public: true });
      expect(byViewer.status).toBe(403);

      const published = await ctx
        .request(editor.token)
        .patch(`/api/projects/${projectId}`, { is_public: true });
      expect(published.status).toBe(200);

      const anonymous = await ctx.request().get(`/api/public/projects/${projectId}/board`);
      expect(anonymous.status).toBe(200);

      const unpublishedByViewer = await ctx
        .request(viewer.token)
        .patch(`/api/projects/${projectId}`, { is_public: false });
      expect(unpublishedByViewer.status).toBe(403);

      const unpublished = await ctx
        .request(editor.token)
        .patch(`/api/projects/${projectId}`, { is_public: false });
      expect(unpublished.status).toBe(200);
      expect((await ctx.request().get(`/api/public/projects/${projectId}/board`)).status).toBe(404);
    });
  });

  describe('an editor member', () => {
    it('still performs every mutation the viewer was refused', async () => {
      const rename = await ctx
        .request(editor.token)
        .patch(`/api/projects/${projectId}`, { name: 've renamed by editor' });
      expect(rename.status).toBe(200);

      const created = await ctx.request(editor.token).post('/api/tasks', {
        id: newId(),
        project_id: projectId,
        column_id: columnId,
        title: 'editor task',
        position: 8000,
      });
      expect(created.status).toBe(201);

      const label = await ctx.request(editor.token).post('/api/labels', {
        id: newId(),
        project_id: projectId,
        name: 'editor label',
        color: '#0000ff',
      });
      expect(label.status).toBe(201);
    });
  });
});
