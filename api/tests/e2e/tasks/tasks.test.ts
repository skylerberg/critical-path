import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db, waitForLockWaiters } from '../../helpers/database';
import { newId, rawJsonWithPosition } from '../../helpers/fixtures';
import { storage } from '../../../src/services/storage/index';
import { ProjectFixtures, validDescription, descriptionWithLink } from './taskFixtures';

describe('Tasks CRUD', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('tasks-crud');
    projectId = await fixtures.createProject('tasks e2e project', { createdBy: user.id });
    columnId = await fixtures.createColumn(projectId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  function taskBody(overrides: Record<string, unknown> = {}) {
    return {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title: 'A task',
      position: 1000,
      ...overrides,
    };
  }

  describe('POST /api/tasks', () => {
    it('requires auth', async () => {
      const res = await ctx.request().post('/api/tasks', taskBody());
      expect(res.status).toBe(401);
    });

    it('creates a task with labels and assignees in board-payload shape', async () => {
      const assignee = await ctx.createUser('tasks-crud-assignee');
      const sharedProjectId = await fixtures.createProject('tasks crud shared', {
        createdBy: user.id,
        memberIds: [assignee.id],
      });
      const sharedColumnId = await fixtures.createColumn(sharedProjectId);
      const labelA = await fixtures.createLabel(sharedProjectId, `label-a-${newId()}`);
      const labelB = await fixtures.createLabel(sharedProjectId, `label-b-${newId()}`);

      const body = taskBody({
        project_id: sharedProjectId,
        column_id: sharedColumnId,
        description: validDescription(),
        label_ids: [labelA, labelB, labelA],
        assignee_ids: [user.id, assignee.id],
      });
      const res = await ctx.request(user.token).post('/api/tasks', body);
      expect(res.status).toBe(201);

      const task = await res.json();
      expect(task).toMatchObject({
        id: body.id,
        column_id: sharedColumnId,
        title: 'A task',
        description: validDescription(),
        position: 1000,
        blocker_ids: [],
        image_count: 0,
        comment_count: 0,
      });
      expect(task.label_ids.sort()).toEqual([labelA, labelB].sort());
      expect(task.assignee_ids.sort()).toEqual([user.id, assignee.id].sort());
      expect(typeof task.created_at).toBe('string');
      expect(typeof task.updated_at).toBe('string');
      expect(task).not.toHaveProperty('project_id');
    });

    it('creates a task without a description as null', async () => {
      const res = await ctx.request(user.token).post('/api/tasks', taskBody());
      expect(res.status).toBe(201);
      const task = await res.json();
      expect(task.description).toBeNull();
      expect(task.label_ids).toEqual([]);
      expect(task.assignee_ids).toEqual([]);
    });

    it('returns 409 for a duplicate task id', async () => {
      const body = taskBody();
      const first = await ctx.request(user.token).post('/api/tasks', body);
      expect(first.status).toBe(201);
      const second = await ctx.request(user.token).post('/api/tasks', body);
      expect(second.status).toBe(409);
    });

    it('returns 404 when the project does not exist, matching an inaccessible project', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ project_id: newId(), column_id: newId() }));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('Project not found');
    });

    it('rejects a column from another project with 422', async () => {
      const otherProject = await fixtures.createProject('other project', { createdBy: user.id });
      const otherColumn = await fixtures.createColumn(otherProject);
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ column_id: otherColumn }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('column_id');
    });

    it('rejects an unknown column with 422', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ column_id: newId() }));
      expect(res.status).toBe(422);
    });

    it('rejects a non-finite position with 422', async () => {
      for (const literal of ['1e999', '-1e999']) {
        const res = await ctx
          .request(user.token)
          .sendRawJson('POST', '/api/tasks', rawJsonWithPosition(taskBody(), literal));
        expect(res.status, literal).toBe(422);
        const body = await res.json();
        expect(body.error).toBe('Validation failed');
        expect(body.details.some((d: { path: string }) => d.path === 'position')).toBe(true);
      }
    });

    it('rejects a label from another project with 422', async () => {
      const otherProject = await fixtures.createProject('other label project', {
        createdBy: user.id,
      });
      const otherLabel = await fixtures.createLabel(otherProject, `foreign-${newId()}`);
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ label_ids: [otherLabel] }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('label');
    });

    it('rejects an unknown assignee with 422', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ assignee_ids: [newId()] }));
      expect(res.status).toBe(422);
    });

    it('rejects a javascript: link href in the description with 422', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ description: descriptionWithLink('javascript:alert(1)') }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Array.isArray(body.details)).toBe(true);
    });

    it('accepts an https: link href in the description', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ description: descriptionWithLink('https://example.com') }));
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().get(`/api/tasks/${newId()}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).get(`/api/tasks/${newId()}`);
      expect(res.status).toBe(404);
    });

    it('returns 400 with a plain error body for a malformed id', async () => {
      const res = await ctx.request(user.token).get('/api/tasks/not-a-uuid');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe('string');
      expect(body.data).toBeUndefined();
      expect(body.success).toBeUndefined();
    });

    it('returns task detail with project_id and an images array', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      expect(created.status).toBe(201);
      const { id } = await created.json();

      const empty = await ctx.request(user.token).get(`/api/tasks/${id}`);
      expect(empty.status).toBe(200);
      const emptyBody = await empty.json();
      expect(emptyBody.project_id).toBe(projectId);
      expect(emptyBody.images).toEqual([]);
      expect(emptyBody.image_count).toBe(0);
      expect(emptyBody.comments).toEqual([]);
      expect(emptyBody.comment_count).toBe(0);

      const imageId = await fixtures.createImageRow(id, { filename: 'shot.png' });
      const res = await ctx.request(user.token).get(`/api/tasks/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.image_count).toBe(1);
      expect(body.images).toHaveLength(1);
      expect(body.images[0]).toMatchObject({
        id: imageId,
        url: `/api/images/${imageId}`,
        filename: 'shot.png',
        content_type: 'image/png',
        size_bytes: 4,
      });
      expect(typeof body.images[0].created_at).toBe('string');
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().patch(`/api/tasks/${newId()}`, { title: 'x' });
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).patch(`/api/tasks/${newId()}`, { title: 'x' });
      expect(res.status).toBe(404);
    });

    it('updates the title and bumps updated_at', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { title: 'renamed' });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.title).toBe('renamed');
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
        new Date(original.updated_at).getTime()
      );
      expect(updated.created_at).toBe(original.created_at);
    });

    it('clears the description with null', async () => {
      const created = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ description: validDescription() }));
      const { id } = await created.json();

      const res = await ctx.request(user.token).patch(`/api/tasks/${id}`, { description: null });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.description).toBeNull();
    });

    it('rejects a javascript: link href in the description with 422', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx.request(user.token).patch(`/api/tasks/${id}`, {
        description: descriptionWithLink('javascript:alert(1)'),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
    });

    it('moves a task with column_id and position', async () => {
      const targetColumn = await fixtures.createColumn(projectId, { name: 'Done', position: 2000 });
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${id}`, { column_id: targetColumn, position: 500 });
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.column_id).toBe(targetColumn);
      expect(updated.position).toBe(500);
    });

    it('rejects a non-finite position with 422', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      for (const literal of ['1e999', '-1e999']) {
        const res = await ctx
          .request(user.token)
          .sendRawJson('PATCH', `/api/tasks/${id}`, rawJsonWithPosition({}, literal));
        expect(res.status, literal).toBe(422);
        expect((await res.json()).error).toBe('Validation failed');
      }
    });

    it('rejects moving to a column of another project with 422', async () => {
      const otherProject = await fixtures.createProject('patch cross project', {
        createdBy: user.id,
      });
      const otherColumn = await fixtures.createColumn(otherProject);
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${id}`, { column_id: otherColumn, position: 500 });
      expect(res.status).toBe(422);
    });

    it('accepts a title patch whose expected_updated_at matches the stored row', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        title: 'guarded rename',
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).title).toBe('guarded rename');
    });

    it('round-trips its own updated_at as the next precondition', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      const first = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        title: 'first',
        expected_updated_at: original.updated_at,
      });
      expect(first.status).toBe(200);
      const afterFirst = await first.json();

      const second = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        title: 'second',
        expected_updated_at: afterFirst.updated_at,
      });
      expect(second.status).toBe(200);
      expect((await second.json()).title).toBe('second');
    });

    it('returns 409 and writes nothing when expected_updated_at is stale', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const winner = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { title: 'first' });
      expect(winner.status).toBe(200);
      expect((await winner.json()).updated_at).not.toBe(original.updated_at);

      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        title: 'second',
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(409);
      expect(typeof (await res.json()).error).toBe('string');

      const after = await ctx.request(user.token).get(`/api/tasks/${original.id}`);
      expect((await after.json()).title).toBe('first');
    });

    it('returns 409 for a stale description write and leaves the stored description intact', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const winner = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { description: validDescription() });
      expect(winner.status).toBe(200);
      const winnerBody = await winner.json();
      expect(winnerBody.updated_at).not.toBe(original.updated_at);
      const stored = winnerBody.description;

      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        description: descriptionWithLink('https://example.com'),
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(409);

      const after = await ctx.request(user.token).get(`/api/tasks/${original.id}`);
      expect((await after.json()).description).toEqual(stored);
    });

    it('still accepts a title patch with no precondition', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await ctx.request(user.token).patch(`/api/tasks/${original.id}`, { title: 'first' });
      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { title: 'unguarded' });
      expect(res.status).toBe(200);
      expect((await res.json()).title).toBe('unguarded');
    });

    it('ignores expected_updated_at on a pure move', async () => {
      const targetColumn = await fixtures.createColumn(projectId, {
        name: 'Moved',
        position: 3000,
      });
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      const bump = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { title: 'bumped' });
      expect(bump.status).toBe(200);

      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        column_id: targetColumn,
        position: 500,
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).column_id).toBe(targetColumn);
    });

    it('leaves updated_at untouched on a pure move', async () => {
      const targetColumn = await fixtures.createColumn(projectId, {
        name: 'Move no bump',
        position: 4000,
      });
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { column_id: targetColumn, position: 500 });
      expect(res.status).toBe(200);
      const moved = await res.json();
      expect(moved.column_id).toBe(targetColumn);
      expect(moved.updated_at).toBe(original.updated_at);
    });

    it('keeps an open editor saveable after someone else moves the task', async () => {
      const targetColumn = await fixtures.createColumn(projectId, {
        name: 'Move then edit',
        position: 5000,
      });
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const move = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { column_id: targetColumn, position: 500 });
      expect(move.status).toBe(200);

      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        title: 'typed while it was dragged',
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(200);
    });

    it('accepts an empty patch body without touching the row', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {});
      expect(res.status).toBe(200);
      const after = await res.json();
      expect(after.title).toBe(original.title);
      expect(after.updated_at).toBe(original.updated_at);
    });

    it('rejects a non-date expected_updated_at with 422', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${id}`, { title: 'x', expected_updated_at: 'nonsense' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Validation failed');
    });

    it('404s for an inaccessible task even with a valid precondition', async () => {
      const outsider = await ctx.createUser('tasks-crud-outsider');
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      const res = await ctx.request(outsider.token).patch(`/api/tasks/${original.id}`, {
        title: 'not yours',
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(404);
    });

    it('lets exactly one of two concurrent guarded patches win', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockHeld = new Promise<void>((resolve) => {
        locked = resolve;
      });
      // Pinning the row until both patches are parked on it is what makes this test fail if the
      // guard ever stops locking the row it reads.
      const holder = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('task')
          .select('task.id')
          .where('task.id', '=', original.id)
          .forUpdate()
          .execute();
        locked();
        await released;
      });
      // holder is in the race so a failed lock surfaces here instead of hanging.
      await Promise.race([lockHeld, holder]);

      const patches = Promise.all([
        ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
          title: 'A',
          expected_updated_at: original.updated_at,
        }),
        ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
          title: 'B',
          expected_updated_at: original.updated_at,
        }),
      ]);
      try {
        await waitForLockWaiters(2);
      } finally {
        release();
      }
      await holder;
      const [a, b] = await patches;

      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const winnerTitle = (await (a.status === 200 ? a : b).json()).title;
      const after = await ctx.request(user.token).get(`/api/tasks/${original.id}`);
      expect((await after.json()).title).toBe(winnerTitle);
    });
  });

  describe('due dates', () => {
    it('creates a task with a due date and echoes the calendar day unchanged', async () => {
      const res = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ due_date: '2026-08-03' }));
      expect(res.status).toBe(201);
      expect((await res.json()).due_date).toBe('2026-08-03');
    });

    it('defaults due_date to null, and takes an explicit null', async () => {
      const omitted = await ctx.request(user.token).post('/api/tasks', taskBody());
      expect((await omitted.json()).due_date).toBeNull();

      const explicit = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ due_date: null }));
      expect(explicit.status).toBe(201);
      expect((await explicit.json()).due_date).toBeNull();
    });

    it('rejects anything that is not a real calendar day with 422', async () => {
      for (const value of [
        '2026-8-3',
        '2026-02-30',
        '2026-13-01',
        '0000-01-01',
        '2026-08-03T00:00:00Z',
        'tomorrow',
      ]) {
        const res = await ctx.request(user.token).post('/api/tasks', taskBody({ due_date: value }));
        expect(res.status, value).toBe(422);
        const body = await res.json();
        expect(body.error).toBe('Validation failed');
        expect(Array.isArray(body.details)).toBe(true);
      }
    });

    it('sets, keeps and clears the date through PATCH', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      const set = await ctx.request(user.token).patch(`/api/tasks/${id}`, {
        due_date: '2026-09-01',
      });
      expect(set.status).toBe(200);
      expect((await set.json()).due_date).toBe('2026-09-01');
      expect((await (await ctx.request(user.token).get(`/api/tasks/${id}`)).json()).due_date).toBe(
        '2026-09-01'
      );

      const renamed = await ctx.request(user.token).patch(`/api/tasks/${id}`, { title: 'renamed' });
      expect((await renamed.json()).due_date).toBe('2026-09-01');

      const cleared = await ctx.request(user.token).patch(`/api/tasks/${id}`, { due_date: null });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).due_date).toBeNull();
    });

    it('rejects a malformed date on PATCH with 422 and leaves the stored date alone', async () => {
      const created = await ctx
        .request(user.token)
        .post('/api/tasks', taskBody({ due_date: '2026-08-03' }));
      const { id } = await created.json();

      const res = await ctx.request(user.token).patch(`/api/tasks/${id}`, { due_date: 'friday' });
      expect(res.status).toBe(422);

      const after = await ctx.request(user.token).get(`/api/tasks/${id}`);
      expect((await after.json()).due_date).toBe('2026-08-03');
    });

    // The date is card metadata, like labels and assignees: bumping updated_at would
    // invalidate the precondition every open editor of that card is holding.
    it('leaves updated_at untouched when only the due date changes', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      await new Promise((resolve) => setTimeout(resolve, 10));
      const res = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { due_date: '2026-10-10' });
      expect(res.status).toBe(200);
      expect((await res.json()).updated_at).toBe(original.updated_at);
    });

    it('ignores expected_updated_at on a due-date-only patch', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const original = await created.json();

      const bump = await ctx
        .request(user.token)
        .patch(`/api/tasks/${original.id}`, { title: 'bumped' });
      expect(bump.status).toBe(200);

      const res = await ctx.request(user.token).patch(`/api/tasks/${original.id}`, {
        due_date: '2026-11-30',
        expected_updated_at: original.updated_at,
      });
      expect(res.status).toBe(200);
      expect((await res.json()).due_date).toBe('2026-11-30');
    });

    it('logs the transition in the activity stream, and nothing for an unchanged date', async () => {
      const created = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id } = await created.json();

      for (const due_date of ['2026-08-03', '2026-08-03', '2026-09-04', null]) {
        expect((await ctx.request(user.token).patch(`/api/tasks/${id}`, { due_date })).status).toBe(
          200
        );
      }

      const res = await ctx.request(user.token).get(`/api/tasks/${id}/activity`);
      const entries = (await res.json()).activity as {
        kind: string;
        old_value: { text?: string } | null;
        new_value: { text?: string } | null;
      }[];
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'due_date_changed',
        'due_date_changed',
        'due_date_changed',
      ]);
      expect(entries.slice(1).map((entry) => [entry.old_value, entry.new_value])).toEqual([
        [null, { text: '2026-08-03' }],
        [{ text: '2026-08-03' }, { text: '2026-09-04' }],
        [{ text: '2026-09-04' }, null],
      ]);
    });

    // Guards the mapper as well as the select: reading the column through node-pg
    // yields a Date at local midnight, so a server east of UTC would answer with
    // the previous day.
    it('answers with the stored calendar day when the process runs east of UTC', async () => {
      vi.stubEnv('TZ', 'Pacific/Kiritimati');
      try {
        const created = await ctx
          .request(user.token)
          .post('/api/tasks', taskBody({ due_date: '2026-08-03' }));
        const createdTask = await created.json();
        expect(createdTask.due_date).toBe('2026-08-03');

        const board = await ctx.request(user.token).get(`/api/projects/${projectId}`);
        const tasks = (await board.json()).tasks as { id: string; due_date: string | null }[];
        expect(tasks.find((task) => task.id === createdTask.id)?.due_date).toBe('2026-08-03');
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe('DELETE /api/tasks/:id', () => {
    it('requires auth', async () => {
      const res = await ctx.request().delete(`/api/tasks/${newId()}`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).delete(`/api/tasks/${newId()}`);
      expect(res.status).toBe(404);
    });

    it('deletes the task, cascades dependencies, and removes stored images post-commit', async () => {
      const createdA = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id: blockerId } = await createdA.json();
      const createdB = await ctx.request(user.token).post('/api/tasks', taskBody());
      const { id: blockedId } = await createdB.json();

      const addBlocker = await ctx
        .request(user.token)
        .post(`/api/tasks/${blockedId}/blockers`, { blocker_task_id: blockerId });
      expect(addBlocker.status).toBe(204);

      const storageKey = newId();
      await storage.put(storageKey, Buffer.from('fake'), 'image/png');
      await fixtures.createImageRow(blockerId, { storageKey });
      expect(await storage.get(storageKey)).not.toBeNull();

      const res = await ctx.request(user.token).delete(`/api/tasks/${blockerId}`);
      expect(res.status).toBe(204);

      const gone = await ctx.request(user.token).get(`/api/tasks/${blockerId}`);
      expect(gone.status).toBe(404);

      const blocked = await ctx.request(user.token).get(`/api/tasks/${blockedId}`);
      const blockedBody = await blocked.json();
      expect(blockedBody.blocker_ids).toEqual([]);

      await vi.waitFor(async () => {
        expect(await storage.get(storageKey)).toBeNull();
      });
    });
  });
});
