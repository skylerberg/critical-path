import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serve, type ServerType } from '@hono/node-server';
import { app } from '../../../src/index';
import { attachRealtime, type RealtimeHandle } from '../../../src/services/realtime/index';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, rankKey } from '../../helpers/fixtures';
import { RtClient } from '../realtime/helpers';
import { CHECKLIST_ITEM_TEXT_MAX_LENGTH } from '../../../src/schemas/checklists';
import { TASK_TITLE_MAX_LENGTH } from '../../../src/schemas/tasks';

interface ChecklistItemBody {
  id: string;
  task_id: string;
  text: string;
  checked: boolean;
  sort_key: string;
  created_at: string;
  updated_at: string;
}

interface BoardTaskBody {
  id: string;
  title: string;
  column_id: string;
  sort_key: string;
  updated_at: string;
  checklist_item_count: number;
  checklist_done_count: number;
}

interface TaskDetailBody extends BoardTaskBody {
  archived_at: string | null;
  checklist_items: ChecklistItemBody[];
}

interface ActivityBody {
  activity: Array<{
    kind: string;
    old_value: { text?: string; id?: string; name?: string } | null;
    new_value: { text?: string; id?: string; name?: string } | null;
  }>;
}

describe('Checklists API', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  let server: ServerType;
  let realtime: RealtimeHandle;
  let port: number;

  let owner: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;

  let projectId: string;
  let columnId: string;

  async function createTask(title = 'card'): Promise<string> {
    const id = newId();
    const res = await ctx.request(owner.token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: columnId,
      title,
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(201);
    return id;
  }

  async function addItem(
    taskId: string,
    text: string,
    position = 1000,
    id = newId()
  ): Promise<ChecklistItemBody> {
    const res = await ctx
      .request(owner.token)
      .post('/api/checklist-items', { id, task_id: taskId, text, sort_key: rankKey(position) });
    expect(res.status).toBe(201);
    return (await res.json()) as ChecklistItemBody;
  }

  async function detail(taskId: string, token = owner.token): Promise<TaskDetailBody> {
    const res = await ctx.request(token).get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    return (await res.json()) as TaskDetailBody;
  }

  async function boardTask(taskId: string): Promise<BoardTaskBody> {
    const res = await ctx.request(owner.token).get(`/api/projects/${projectId}`);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { tasks: BoardTaskBody[] };
    const task = payload.tasks.find((t) => t.id === taskId);
    expect(task).toBeDefined();
    return task as BoardTaskBody;
  }

  async function activity(taskId: string): Promise<ActivityBody['activity']> {
    const res = await ctx.request(owner.token).get(`/api/tasks/${taskId}/activity`);
    expect(res.status).toBe(200);
    return ((await res.json()) as ActivityBody).activity;
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
        port = info.port;
        resolve();
      });
    });
    realtime = attachRealtime(server);

    owner = await ctx.createUser('cl-owner');
    viewer = await ctx.createUser('cl-viewer');
    outsider = await ctx.createUser('cl-outsider');

    projectId = newId();
    projectIds.push(projectId);
    const created = await ctx
      .request(owner.token)
      .post('/api/projects', { id: projectId, name: 'checklist project' });
    expect(created.status).toBe(201);
    columnId = ((await created.json()) as { columns: Array<{ id: string }> }).columns[0].id;

    const members = await ctx.request(owner.token).put(`/api/projects/${projectId}/members`, {
      user_ids: [viewer.id],
      roles: [{ user_id: viewer.id, role: 'viewer' }],
    });
    expect(members.status).toBe(204);
  });

  afterAll(async () => {
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (projectIds.length > 0) {
      await db.deleteFrom('project').where('id', 'in', projectIds).execute();
    }
    await ctx.cleanup();
  });

  it('keeps the item text limit equal to the task title limit', () => {
    expect(CHECKLIST_ITEM_TEXT_MAX_LENGTH).toBe(TASK_TITLE_MAX_LENGTH);
  });

  describe('POST /api/checklist-items', () => {
    it('creates an item and moves both counts on the board payload', async () => {
      const taskId = await createTask();
      expect(await boardTask(taskId)).toMatchObject({
        checklist_item_count: 0,
        checklist_done_count: 0,
      });

      const item = await addItem(taskId, 'first');
      expect(item).toMatchObject({ task_id: taskId, text: 'first', checked: false });
      expect(item.updated_at).toBe(item.created_at);
      expect(await boardTask(taskId)).toMatchObject({
        checklist_item_count: 1,
        checklist_done_count: 0,
      });
    });

    it('returns 409 for a duplicate id', async () => {
      const taskId = await createTask();
      const id = newId();
      await addItem(taskId, 'first', 1000, id);
      const again = await ctx.request(owner.token).post('/api/checklist-items', {
        id,
        task_id: taskId,
        text: 'again',
        sort_key: rankKey(2000),
      });
      expect(again.status).toBe(409);
      expect(await again.json()).toEqual({ error: 'Checklist item id already in use' });
    });

    it('accepts text at the limit and refuses one character more or a blank', async () => {
      const taskId = await createTask();
      const atLimit = 'x'.repeat(CHECKLIST_ITEM_TEXT_MAX_LENGTH);
      const accepted = await addItem(taskId, atLimit);
      expect(accepted.text).toBe(atLimit);

      for (const text of ['x'.repeat(CHECKLIST_ITEM_TEXT_MAX_LENGTH + 1), '   ', '']) {
        const res = await ctx.request(owner.token).post('/api/checklist-items', {
          id: newId(),
          task_id: taskId,
          text,
          sort_key: rankKey(2000),
        });
        expect(res.status).toBe(422);
      }
    });

    it('imports an already-ticked item in one call', async () => {
      const taskId = await createTask();
      const res = await ctx.request(owner.token).post('/api/checklist-items', {
        id: newId(),
        task_id: taskId,
        text: 'already done',
        sort_key: rankKey(1000),
        checked: true,
      });
      expect(res.status).toBe(201);
      expect((await res.json()) as ChecklistItemBody).toMatchObject({ checked: true });
      expect(await boardTask(taskId)).toMatchObject({
        checklist_item_count: 1,
        checklist_done_count: 1,
      });
    });

    it('returns 404 for an unknown task and for one in an inaccessible project', async () => {
      const taskId = await createTask();
      for (const [token, target] of [
        [owner.token, newId()],
        [outsider.token, taskId],
      ] as const) {
        const res = await ctx.request(token).post('/api/checklist-items', {
          id: newId(),
          task_id: target,
          text: 'nope',
          sort_key: rankKey(1000),
        });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Task not found' });
      }
    });
  });

  describe('GET /api/tasks/:id', () => {
    // Keys are unique per task, so there is no tie left to break -- the order is
    // the keys' own, whatever order the rows were written in.
    it('embeds the checklist in key order, not insertion order', async () => {
      const taskId = await createTask();
      await addItem(taskId, 'third', 3000);
      await addItem(taskId, 'second', 2000);
      await addItem(taskId, 'first', 1000);

      expect((await detail(taskId)).checklist_items.map((item) => item.text)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('still serves the checklist of an archived card', async () => {
      const taskId = await createTask();
      await addItem(taskId, 'survives the archive');
      expect((await ctx.request(owner.token).post(`/api/tasks/${taskId}/archive`)).status).toBe(
        200
      );

      const archived = await detail(taskId);
      expect(archived.archived_at).not.toBeNull();
      expect(archived.checklist_items.map((item) => item.text)).toEqual(['survives the archive']);
    });
  });

  describe('PATCH /api/checklist-items/:id', () => {
    it('ticks an item and moves the done count', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'tick me');

      const res = await ctx
        .request(owner.token)
        .patch(`/api/checklist-items/${item.id}`, { checked: true });
      expect(res.status).toBe(200);
      const updated = (await res.json()) as ChecklistItemBody;
      expect(updated.checked).toBe(true);
      expect(Date.parse(updated.updated_at)).toBeGreaterThan(Date.parse(item.updated_at));
      expect(await boardTask(taskId)).toMatchObject({
        checklist_item_count: 1,
        checklist_done_count: 1,
      });
    });

    it('keeps the done count after the card is archived', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'done before archiving');
      expect(
        (await ctx.request(owner.token).patch(`/api/checklist-items/${item.id}`, { checked: true }))
          .status
      ).toBe(200);
      expect((await ctx.request(owner.token).post(`/api/tasks/${taskId}/archive`)).status).toBe(
        200
      );

      const archived = await ctx
        .request(owner.token)
        .get(`/api/projects/${projectId}/archived-tasks`);
      expect(archived.status).toBe(200);
      const rows = ((await archived.json()) as { tasks: BoardTaskBody[] }).tasks;
      expect(rows.find((t) => t.id === taskId)).toMatchObject({
        checklist_item_count: 1,
        checklist_done_count: 1,
      });
    });

    it('reorders on a position-only patch and leaves updated_at alone', async () => {
      const taskId = await createTask();
      const first = await addItem(taskId, 'a', 1000);
      await addItem(taskId, 'b', 2000);

      const movedKey = rankKey(3000);

      const res = await ctx
        .request(owner.token)
        .patch(`/api/checklist-items/${first.id}`, { sort_key: movedKey });
      expect(res.status).toBe(200);
      expect((await res.json()) as ChecklistItemBody).toMatchObject({
        sort_key: movedKey,
        updated_at: first.updated_at,
      });
      expect((await detail(taskId)).checklist_items.map((item) => item.text)).toEqual(['b', 'a']);
    });

    it('reorders onto a key a sibling item is holding', async () => {
      const taskId = await createTask();
      const first = await addItem(taskId, 'a', 1000);
      const second = await addItem(taskId, 'b', 2000);

      const res = await ctx
        .request(owner.token)
        .patch(`/api/checklist-items/${first.id}`, { sort_key: second.sort_key });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ChecklistItemBody).sort_key > second.sort_key).toBe(true);
      expect((await detail(taskId)).checklist_items.map((item) => item.text)).toEqual(['b', 'a']);
    });

    it('leaves a key free on the task alone, even when a sibling task holds it', async () => {
      const otherTask = await createTask();
      const elsewhere = await addItem(otherTask, 'elsewhere', 4000);

      const taskId = await createTask();
      const item = await addItem(taskId, 'mine', 1000);

      const res = await ctx
        .request(owner.token)
        .patch(`/api/checklist-items/${item.id}`, { sort_key: elsewhere.sort_key });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ChecklistItemBody).sort_key).toBe(elsewhere.sort_key);
    });

    it('changes nothing on an empty body', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'unchanged');
      const res = await ctx.request(owner.token).patch(`/api/checklist-items/${item.id}`, {});
      expect(res.status).toBe(200);
      expect((await res.json()) as ChecklistItemBody).toEqual(item);
    });

    it('returns 404 for an unknown item and for one in an inaccessible project', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'private');
      for (const [token, target] of [
        [owner.token, newId()],
        [outsider.token, item.id],
      ] as const) {
        const res = await ctx
          .request(token)
          .patch(`/api/checklist-items/${target}`, { checked: true });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Checklist item not found' });
      }
    });
  });

  describe("the parent task's updated_at", () => {
    // The precondition is honored only when the patch also carries content, so
    // the follow-up must send a title — without it a 200 proves nothing.
    async function contentPatchWith(taskId: string, expected: string): Promise<Response> {
      return ctx
        .request(owner.token)
        .patch(`/api/tasks/${taskId}`, { title: 'renamed', expected_updated_at: expected });
    }

    it('is untouched by an add, a tick, a rename, a reposition and a delete', async () => {
      const taskId = await createTask();
      const before = (await boardTask(taskId)).updated_at;

      const item = await addItem(taskId, 'one');
      const second = await addItem(taskId, 'two', 2000);
      for (const body of [
        { checked: true },
        { text: 'renamed item' },
        { sort_key: rankKey(5000) },
      ]) {
        expect(
          (await ctx.request(owner.token).patch(`/api/checklist-items/${item.id}`, body)).status
        ).toBe(200);
      }
      expect(
        (await ctx.request(owner.token).delete(`/api/checklist-items/${second.id}`)).status
      ).toBe(204);

      expect((await boardTask(taskId)).updated_at).toBe(before);
      const guarded = await contentPatchWith(taskId, before);
      expect(guarded.status).toBe(200);
    });

    it('makes that same precondition fail once the title really moves', async () => {
      const taskId = await createTask();
      const before = (await boardTask(taskId)).updated_at;
      expect((await contentPatchWith(taskId, before)).status).toBe(200);
      const stale = await contentPatchWith(taskId, before);
      expect(stale.status).toBe(409);
    });
  });

  describe('DELETE /api/checklist-items/:id', () => {
    it('deletes once, then answers 404', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'goodbye');

      expect(
        (await ctx.request(owner.token).delete(`/api/checklist-items/${item.id}`)).status
      ).toBe(204);
      expect(await boardTask(taskId)).toMatchObject({ checklist_item_count: 0 });
      expect(
        (await ctx.request(owner.token).delete(`/api/checklist-items/${item.id}`)).status
      ).toBe(404);
    });

    it('takes the items with the task', async () => {
      const taskId = await createTask();
      await addItem(taskId, 'cascades');
      await ctx.request(owner.token).post(`/api/tasks/${taskId}/archive`);
      expect((await ctx.request(owner.token).delete(`/api/tasks/${taskId}`)).status).toBe(204);
      const rows = await db
        .selectFrom('checklist_item')
        .select('id')
        .where('task_id', '=', taskId)
        .execute();
      expect(rows).toEqual([]);
    });
  });

  describe('POST /api/checklist-items/:id/promote', () => {
    it('creates a bare card in the parent column and removes the item', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'becomes a card');

      const newTaskId = newId();
      const res = await ctx.request(owner.token).post(`/api/checklist-items/${item.id}/promote`, {
        id: newTaskId,
        sort_key: rankKey(1500),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as BoardTaskBody & {
        label_ids: string[];
        assignee_ids: string[];
        blocker_ids: string[];
        due_date: string | null;
        description: unknown;
      };
      expect(created).toMatchObject({
        id: newTaskId,
        title: 'becomes a card',
        column_id: columnId,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        due_date: null,
        description: null,
      });
      expect((await detail(taskId)).checklist_items).toEqual([]);
      expect(await boardTask(taskId)).toMatchObject({ checklist_item_count: 0 });
      expect((await activity(newTaskId)).map((entry) => entry.kind)).toEqual(['created']);
    });

    it('ranks the new card past a key a card in the column is holding', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'promote onto a taken key');
      const takenKey = (await boardTask(taskId)).sort_key;

      const res = await ctx
        .request(owner.token)
        .post(`/api/checklist-items/${item.id}/promote`, { id: newId(), sort_key: takenKey });
      expect(res.status).toBe(201);
      expect(((await res.json()) as BoardTaskBody).sort_key > takenKey).toBe(true);
    });

    it('promotes once in sequence: the second call is 404 and creates no second card', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'promote me once');

      const first = await ctx
        .request(owner.token)
        .post(`/api/checklist-items/${item.id}/promote`, { id: newId(), sort_key: rankKey(1500) });
      expect(first.status).toBe(201);

      const second = await ctx
        .request(owner.token)
        .post(`/api/checklist-items/${item.id}/promote`, { id: newId(), sort_key: rankKey(1600) });
      expect(second.status).toBe(404);

      const cards = await db
        .selectFrom('task')
        .select('id')
        .where('project_id', '=', projectId)
        .where('title', '=', 'promote me once')
        .execute();
      expect(cards).toHaveLength(1);
    });

    // The only test that fails when the route stops deleting first: the delete's
    // row lock serializes the racers, and its zero-row result is what tells the
    // loser it has nothing to promote.
    it('creates exactly one card when two promotes race the same item', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const title = `raced ${String(attempt)}`;
        const taskId = await createTask();
        const item = await addItem(taskId, title);

        const promote = (): Promise<Response> =>
          ctx.request(owner.token).post(`/api/checklist-items/${item.id}/promote`, {
            id: newId(),
            sort_key: rankKey(1500),
          });
        const statuses = (await Promise.all([promote(), promote()]))
          .map((res) => res.status)
          .sort((a, b) => a - b);

        expect(statuses).toEqual([201, 404]);
        const cards = await db
          .selectFrom('task')
          .select('id')
          .where('project_id', '=', projectId)
          .where('title', '=', title)
          .execute();
        expect(cards).toHaveLength(1);
      }
    });

    it('returns 409 for a used task id and leaves the item in place', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'stays put');

      const res = await ctx
        .request(owner.token)
        .post(`/api/checklist-items/${item.id}/promote`, { id: taskId, sort_key: rankKey(1500) });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Task id already in use' });
      expect((await detail(taskId)).checklist_items.map((i) => i.id)).toEqual([item.id]);
    });
  });

  describe('activity', () => {
    it('records one entry per add, tick, untick, rename, delete and promote', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'logged');
      for (const body of [{ checked: true }, { checked: false }, { text: 'logged again' }]) {
        expect(
          (await ctx.request(owner.token).patch(`/api/checklist-items/${item.id}`, body)).status
        ).toBe(200);
      }
      const removed = await addItem(taskId, 'removed', 2000);
      expect(
        (await ctx.request(owner.token).delete(`/api/checklist-items/${removed.id}`)).status
      ).toBe(204);
      const promoted = await addItem(taskId, 'promoted', 3000);
      const promotedTaskId = newId();
      expect(
        (
          await ctx.request(owner.token).post(`/api/checklist-items/${promoted.id}/promote`, {
            id: promotedTaskId,
            sort_key: rankKey(4000),
          })
        ).status
      ).toBe(201);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'checklist_item_added',
        'checklist_item_checked',
        'checklist_item_unchecked',
        'checklist_item_renamed',
        'checklist_item_added',
        'checklist_item_removed',
        'checklist_item_added',
        'checklist_item_promoted',
      ]);
      const renamed = entries.find((entry) => entry.kind === 'checklist_item_renamed');
      expect(renamed?.old_value).toEqual({ text: 'logged' });
      expect(renamed?.new_value).toEqual({ text: 'logged again' });
      const promotedEntry = entries.find((entry) => entry.kind === 'checklist_item_promoted');
      expect(promotedEntry?.old_value).toEqual({ text: 'promoted' });
      expect(promotedEntry?.new_value).toEqual({ id: promotedTaskId, name: 'promoted' });
    });

    it('records nothing for a position-only patch or a no-op tick', async () => {
      const taskId = await createTask();
      const item = await addItem(taskId, 'quiet');
      const before = (await activity(taskId)).length;

      for (const body of [{ sort_key: rankKey(9000) }, { checked: false }, { text: 'quiet' }]) {
        expect(
          (await ctx.request(owner.token).patch(`/api/checklist-items/${item.id}`, body)).status
        ).toBe(200);
      }
      expect((await activity(taskId)).length).toBe(before);
    });
  });

  describe('copying', () => {
    async function itemsOf(taskId: string): Promise<Array<[string, boolean]>> {
      return (await detail(taskId)).checklist_items.map((item) => [item.text, item.checked]);
    }

    it('carries the items through a card duplicate with fresh ids', async () => {
      const taskId = await createTask('source card');
      const first = await addItem(taskId, 'one', 1000);
      await addItem(taskId, 'two', 2000);
      await addItem(taskId, 'three', 3000);
      expect(
        (
          await ctx
            .request(owner.token)
            .patch(`/api/checklist-items/${first.id}`, { checked: true })
        ).status
      ).toBe(200);

      const copyId = newId();
      const res = await ctx
        .request(owner.token)
        .post(`/api/tasks/${taskId}/duplicate`, { id: copyId, sort_key: rankKey(5000) });
      expect(res.status).toBe(201);
      expect((await res.json()) as BoardTaskBody).toMatchObject({
        checklist_item_count: 3,
        checklist_done_count: 1,
      });

      expect(await itemsOf(copyId)).toEqual([
        ['one', true],
        ['two', false],
        ['three', false],
      ]);
      const sourceIds = (await detail(taskId)).checklist_items.map((item) => item.id);
      const copyIds = (await detail(copyId)).checklist_items.map((item) => item.id);
      expect(copyIds.filter((id) => sourceIds.includes(id))).toEqual([]);
    });

    it('carries the items through a column duplicate and a project copy', async () => {
      const taskId = await createTask('column source');
      await addItem(taskId, 'alpha', 1000);
      const beta = await addItem(taskId, 'beta', 2000);
      expect(
        (await ctx.request(owner.token).patch(`/api/checklist-items/${beta.id}`, { checked: true }))
          .status
      ).toBe(200);

      const columnCopy = await ctx
        .request(owner.token)
        .post(`/api/columns/${columnId}/duplicate`, { id: newId(), sort_key: rankKey(9000) });
      expect(columnCopy.status).toBe(201);
      const copiedTasks = ((await columnCopy.json()) as { tasks: BoardTaskBody[] }).tasks;
      const copiedCard = copiedTasks.find((t) => t.title === 'column source');
      expect(copiedCard).toBeDefined();
      expect(await itemsOf((copiedCard as BoardTaskBody).id)).toEqual([
        ['alpha', false],
        ['beta', true],
      ]);

      const copiedProjectId = newId();
      projectIds.push(copiedProjectId);
      const projectCopy = await ctx.request(owner.token).post('/api/projects', {
        id: copiedProjectId,
        name: 'checklist copy',
        source_project_id: projectId,
      });
      expect(projectCopy.status).toBe(201);
      const copiedProject = (await projectCopy.json()) as { tasks: BoardTaskBody[] };
      const projectCard = copiedProject.tasks.find((t) => t.title === 'column source');
      expect(projectCard).toBeDefined();
      expect(await itemsOf((projectCard as BoardTaskBody).id)).toEqual([
        ['alpha', false],
        ['beta', true],
      ]);
    });
  });

  describe('realtime', () => {
    it('delivers all three types with both counts to a viewer', async () => {
      const client = await RtClient.connect(port, viewer.token);
      try {
        client.subscribe(projectId);
        const taskId = await createTask('watched card');
        const item = await addItem(taskId, 'watched item');

        const created = await client.waitForEvent(
          (event) => event.type === 'checklist_item_created'
        );
        expect(created.data).toMatchObject({
          id: item.id,
          task_id: taskId,
          text: 'watched item',
          checked: false,
          checklist_item_count: 1,
          checklist_done_count: 0,
        });

        expect(
          (
            await ctx
              .request(owner.token)
              .patch(`/api/checklist-items/${item.id}`, { checked: true })
          ).status
        ).toBe(200);
        const updated = await client.waitForEvent(
          (event) => event.type === 'checklist_item_updated'
        );
        expect(updated.data).toMatchObject({
          id: item.id,
          checked: true,
          checklist_item_count: 1,
          checklist_done_count: 1,
        });

        expect(
          (await ctx.request(owner.token).delete(`/api/checklist-items/${item.id}`)).status
        ).toBe(204);
        const deleted = await client.waitForEvent(
          (event) => event.type === 'checklist_item_deleted'
        );
        expect(deleted.data).toEqual({
          id: item.id,
          task_id: taskId,
          checklist_item_count: 0,
          checklist_done_count: 0,
        });
      } finally {
        client.close();
      }
    });

    it('publishes both a task_created and a checklist_item_deleted for a promote', async () => {
      const client = await RtClient.connect(port, owner.token);
      try {
        client.subscribe(projectId);
        const taskId = await createTask('promote source');
        const item = await addItem(taskId, 'promote via socket');
        const from = client.events.length;

        const newTaskId = newId();
        expect(
          (
            await ctx.request(owner.token).post(`/api/checklist-items/${item.id}/promote`, {
              id: newTaskId,
              sort_key: rankKey(1500),
            })
          ).status
        ).toBe(201);

        const created = await client.waitForEvent(
          (event) =>
            event.type === 'task_created' && (event.data as { id: string }).id === newTaskId,
          { from }
        );
        expect(created.data).toMatchObject({ title: 'promote via socket' });
        const removed = await client.waitForEvent(
          (event) =>
            event.type === 'checklist_item_deleted' &&
            (event.data as { id: string }).id === item.id,
          { from }
        );
        expect(removed.data).toMatchObject({ task_id: taskId, checklist_item_count: 0 });
      } finally {
        client.close();
      }
    });
  });

  describe('public boards', () => {
    it('publishes items and counts, and never those of a private project', async () => {
      const taskId = await createTask('public card');
      const done = await addItem(taskId, 'public done', 1000);
      await addItem(taskId, 'public open', 2000);
      expect(
        (await ctx.request(owner.token).patch(`/api/checklist-items/${done.id}`, { checked: true }))
          .status
      ).toBe(200);

      const closed = await ctx.request().get(`/api/public/projects/${projectId}/board`);
      expect(closed.status).toBe(404);

      expect(
        (await ctx.request(owner.token).patch(`/api/projects/${projectId}`, { is_public: true }))
          .status
      ).toBe(200);
      const res = await ctx.request().get(`/api/public/projects/${projectId}/board`);
      expect(res.status).toBe(200);
      const payload = (await res.json()) as {
        tasks: BoardTaskBody[];
        checklist_items: Array<{ task_id: string; text: string; checked: boolean }>;
      };
      expect(payload.tasks.find((t) => t.id === taskId)).toMatchObject({
        checklist_item_count: 2,
        checklist_done_count: 1,
      });
      expect(
        payload.checklist_items
          .filter((item) => item.task_id === taskId)
          .map((item) => [item.text, item.checked])
      ).toEqual([
        ['public done', true],
        ['public open', false],
      ]);

      expect(
        (await ctx.request(owner.token).patch(`/api/projects/${projectId}`, { is_public: false }))
          .status
      ).toBe(200);
      expect((await ctx.request().get(`/api/public/projects/${projectId}/board`)).status).toBe(404);
    });
  });

  describe('a viewer', () => {
    it('reads the checklist but cannot change it', async () => {
      const taskId = await createTask('viewer card');
      const item = await addItem(taskId, 'viewer reads this');

      expect((await detail(taskId, viewer.token)).checklist_items.map((i) => i.text)).toEqual([
        'viewer reads this',
      ]);
      const res = await ctx
        .request(viewer.token)
        .patch(`/api/checklist-items/${item.id}`, { checked: true });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Read-only access to this project' });
    });
  });

  describe('export', () => {
    const key1000 = rankKey(1000);
    it('carries the items, on live and archived cards alike', async () => {
      const exportProjectId = newId();
      projectIds.push(exportProjectId);
      const created = await ctx
        .request(owner.token)
        .post('/api/projects', { id: exportProjectId, name: 'checklist export' });
      expect(created.status).toBe(201);
      const exportColumnId = ((await created.json()) as { columns: Array<{ id: string }> })
        .columns[0].id;

      const liveId = newId();
      const archivedId = newId();
      for (const [id, title] of [
        [liveId, 'live card'],
        [archivedId, 'archived card'],
      ] as const) {
        expect(
          (
            await ctx.request(owner.token).post('/api/tasks', {
              id,
              project_id: exportProjectId,
              column_id: exportColumnId,
              title,
              sort_key: rankKey(1000),
            })
          ).status
        ).toBe(201);
        expect(
          (
            await ctx.request(owner.token).post('/api/checklist-items', {
              id: newId(),
              task_id: id,
              text: `${title} item`,
              sort_key: key1000,
            })
          ).status
        ).toBe(201);
      }
      expect((await ctx.request(owner.token).post(`/api/tasks/${archivedId}/archive`)).status).toBe(
        200
      );

      const res = await ctx
        .request(owner.token)
        .get(`/api/projects/${exportProjectId}/export?format=json`);
      expect(res.status).toBe(200);
      const payload = (await res.json()) as {
        tasks: Array<{
          id: string;
          checklist_item_count: number;
          checklist_done_count: number;
          checklist_items: Array<{ id: string; text: string; checked: boolean; position: number }>;
        }>;
      };
      const byId = new Map(payload.tasks.map((task) => [task.id, task]));
      expect(byId.get(liveId)?.checklist_items.map((item) => item.text)).toEqual([
        'live card item',
      ]);
      expect(byId.get(archivedId)?.checklist_items.map((item) => item.text)).toEqual([
        'archived card item',
      ]);
      expect(Object.keys(byId.get(liveId)?.checklist_items[0] ?? {}).sort()).toEqual([
        'checked',
        'id',
        'sort_key',
        'text',
      ]);
      // Both counts ship, following comment_count rather than image_count: an
      // export that dropped one derived count and kept another would be arbitrary.
      expect(byId.get(liveId)).toMatchObject({
        checklist_item_count: 1,
        checklist_done_count: 0,
      });
    });
  });
});
