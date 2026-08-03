import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { ProjectFixtures, validDescription } from './taskFixtures';
import { errorHandler } from '../../../src/middleware/errorHandler';
import { transactionMiddleware } from '../../../src/middleware/transaction';
import { recordTaskActivity } from '../../../src/services/taskActivity';
import type { Variables } from '../../../src/types/index';

interface ActivityValue {
  text?: string;
  id?: string;
  name?: string;
  doc?: { type: string; content?: unknown[] } | null;
}

interface ActivityEntry {
  id: string;
  kind: string;
  actor_user_id: string;
  old_value: ActivityValue | null;
  new_value: ActivityValue | null;
  created_at: string;
}

describe('Task activity', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let columnId: string;
  let otherColumnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('activity');
    member = await ctx.createUser('activity-member');
    outsider = await ctx.createUser('activity-outsider');
    projectId = await fixtures.createProject('activity e2e project', {
      createdBy: user.id,
      memberIds: [member.id],
    });
    columnId = await fixtures.createColumn(projectId, { name: 'Backlog' });
    otherColumnId = await fixtures.createColumn(projectId, { name: 'In Progress', position: 2000 });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function activity(taskId: string, token = user.token): Promise<ActivityEntry[]> {
    const res = await ctx.request(token).get(`/api/tasks/${taskId}/activity`);
    expect(res.status).toBe(200);
    return ((await res.json()) as { activity: ActivityEntry[] }).activity;
  }

  async function kinds(taskId: string): Promise<string[]> {
    return (await activity(taskId)).map((entry) => entry.kind);
  }

  async function createTask(title = 'a task', token = user.token): Promise<string> {
    const id = newId();
    const res = await ctx.request(token).post('/api/tasks', {
      id,
      project_id: projectId,
      column_id: columnId,
      title,
      position: 1000,
    });
    expect(res.status).toBe(201);
    return id;
  }

  describe('GET /api/tasks/:id/activity', () => {
    it('requires auth', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      const res = await ctx.request().get(`/api/tasks/${taskId}/activity`);
      expect(res.status).toBe(401);
    });

    it('returns 400 for a malformed task id', async () => {
      const res = await ctx.request(user.token).get('/api/tasks/not-a-uuid/activity');
      expect(res.status).toBe(400);
    });

    it('returns 404 for an unknown task', async () => {
      const res = await ctx.request(user.token).get(`/api/tasks/${newId()}/activity`);
      expect(res.status).toBe(404);
    });

    it('returns 404, never 403, for a task in an inaccessible project', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      const res = await ctx.request(outsider.token).get(`/api/tasks/${taskId}/activity`);
      expect(res.status).toBe(404);
    });

    it('is readable by a project member who did not create the task', async () => {
      const taskId = await createTask('member readable');
      const entries = await activity(taskId, member.token);
      expect(entries.map((entry) => entry.kind)).toEqual(['created']);
    });

    it('is empty for a task that predates the log', async () => {
      const taskId = await fixtures.createTaskRow(projectId, columnId);
      expect(await activity(taskId)).toEqual([]);
    });
  });

  describe('creation', () => {
    it('records one entry naming the creator and the title', async () => {
      const taskId = await createTask('brand new card');
      const entries = await activity(taskId);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        kind: 'created',
        actor_user_id: user.id,
        old_value: null,
        new_value: { text: 'brand new card' },
      });
      expect(Number.isNaN(Date.parse(entries[0]!.created_at))).toBe(false);
    });
  });

  describe('PATCH /api/tasks/:id', () => {
    it('records a title change with both sides, and nothing for an unchanged title', async () => {
      const taskId = await createTask('first title');

      expect(
        (await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { title: 'second title' }))
          .status
      ).toBe(200);
      expect(
        (await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { title: 'second title' }))
          .status
      ).toBe(200);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual(['created', 'title_changed']);
      expect(entries[1]).toMatchObject({
        old_value: { text: 'first title' },
        new_value: { text: 'second title' },
      });
    });

    it('records a description change and ignores a resend with reordered keys', async () => {
      const taskId = await createTask('described');
      const doc = validDescription('the description');

      expect(
        (await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: doc })).status
      ).toBe(200);

      const reordered = {
        content: [{ content: [{ text: 'the description', type: 'text' }], type: 'paragraph' }],
        type: 'doc',
      };
      expect(
        (await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: reordered }))
          .status
      ).toBe(200);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual(['created', 'description_changed']);
      expect(entries[1]!.old_value).toEqual({ doc: null });
      expect(entries[1]!.new_value).toEqual({ doc });
    });

    it('coalesces consecutive description edits by the same actor into one entry', async () => {
      const taskId = await createTask('coalescing');
      const first = validDescription('draft one');
      const second = validDescription('draft two');

      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: first });
      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: second });

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual(['created', 'description_changed']);
      expect(entries[1]!.old_value).toEqual({ doc: null });
      expect(entries[1]!.new_value).toEqual({ doc: second });
    });

    it('drops the coalesced entry when the edit ends back where it started', async () => {
      const taskId = await createTask('undone');

      await ctx
        .request(user.token)
        .patch(`/api/tasks/${taskId}`, { description: validDescription('a false start') });
      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: null });

      expect(await kinds(taskId)).toEqual(['created']);
    });

    it('starts a new description entry after another entry or another actor intervenes', async () => {
      const taskId = await createTask('interrupted');
      const first = validDescription('draft one');
      const second = validDescription('draft two');
      const third = validDescription('draft three');

      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: first });
      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { title: 'renamed mid-edit' });
      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { description: second });
      await ctx.request(member.token).patch(`/api/tasks/${taskId}`, { description: third });

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'description_changed',
        'title_changed',
        'description_changed',
        'description_changed',
      ]);
      expect(entries[3]!.old_value).toEqual({ doc: first });
      expect(entries[3]!.actor_user_id).toBe(user.id);
      expect(entries[4]!.old_value).toEqual({ doc: second });
      expect(entries[4]!.actor_user_id).toBe(member.id);
    });

    it('records a column move with both column names, and nothing for a move within a column', async () => {
      const taskId = await createTask('moving');

      expect(
        (
          await ctx
            .request(user.token)
            .patch(`/api/tasks/${taskId}`, { column_id: otherColumnId, position: 2000 })
        ).status
      ).toBe(200);
      expect(
        (await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { position: 3000 })).status
      ).toBe(200);
      expect(
        (
          await ctx
            .request(user.token)
            .patch(`/api/tasks/${taskId}`, { column_id: otherColumnId, position: 4000 })
        ).status
      ).toBe(200);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual(['created', 'column_changed']);
      expect(entries[1]).toMatchObject({
        old_value: { id: columnId, name: 'Backlog' },
        new_value: { id: otherColumnId, name: 'In Progress' },
      });
    });

    it('records title, description and column from one patch in that order', async () => {
      const taskId = await createTask('multi-field');

      const res = await ctx.request(user.token).patch(`/api/tasks/${taskId}`, {
        title: 'renamed',
        description: validDescription('and described'),
        column_id: otherColumnId,
        position: 2000,
      });
      expect(res.status).toBe(200);

      expect(await kinds(taskId)).toEqual([
        'created',
        'title_changed',
        'description_changed',
        'column_changed',
      ]);
    });

    it('writes nothing when the precondition rejects the patch', async () => {
      const taskId = await createTask('guarded');
      const res = await ctx.request(user.token).patch(`/api/tasks/${taskId}`, {
        title: 'never applied',
        expected_updated_at: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(res.status).toBe(409);
      expect(await kinds(taskId)).toEqual(['created']);
    });
  });

  describe('PUT /api/tasks/:id/labels', () => {
    it('records added and removed labels by name and ignores an unchanged set', async () => {
      const taskId = await createTask('labelled');
      const alphaName = `alpha-${newId()}`;
      const alpha = await fixtures.createLabel(projectId, alphaName);
      const beta = await fixtures.createLabel(projectId, `beta-${newId()}`);

      await ctx
        .request(user.token)
        .put(`/api/tasks/${taskId}/labels`, { label_ids: [alpha, beta] });
      await ctx.request(user.token).put(`/api/tasks/${taskId}/labels`, { label_ids: [beta] });
      await ctx.request(user.token).put(`/api/tasks/${taskId}/labels`, { label_ids: [beta] });

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'label_added',
        'label_added',
        'label_removed',
      ]);
      expect(
        entries
          .slice(1, 3)
          .map((entry) => entry.new_value?.id)
          .sort()
      ).toEqual([alpha, beta].sort());
      expect(entries[3]!.old_value).toEqual({ id: alpha, name: alphaName });
      expect(entries[3]!.new_value).toBeNull();
    });
  });

  describe('PUT /api/tasks/:id/assignees', () => {
    it('records added and removed assignees by name and ignores an unchanged set', async () => {
      const taskId = await createTask('assigned');

      await ctx
        .request(user.token)
        .put(`/api/tasks/${taskId}/assignees`, { user_ids: [member.id] });
      await ctx.request(user.token).put(`/api/tasks/${taskId}/assignees`, { user_ids: [] });
      await ctx.request(user.token).put(`/api/tasks/${taskId}/assignees`, { user_ids: [] });

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'assignee_added',
        'assignee_removed',
      ]);
      expect(entries[1]!.new_value).toEqual({ id: member.id, name: member.name });
      expect(entries[2]!.old_value).toEqual({ id: member.id, name: member.name });
    });
  });

  describe('blockers', () => {
    it('records adding and removing a blocker by title, and nothing for idempotent repeats', async () => {
      const taskId = await createTask('blocked');
      const blockerId = await createTask('the blocker');

      await ctx
        .request(user.token)
        .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerId });
      await ctx
        .request(user.token)
        .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerId });
      await ctx.request(user.token).delete(`/api/tasks/${taskId}/blockers/${blockerId}`);
      await ctx.request(user.token).delete(`/api/tasks/${taskId}/blockers/${blockerId}`);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'blocker_added',
        'blocker_removed',
      ]);
      expect(entries[1]!.new_value).toEqual({ id: blockerId, name: 'the blocker' });
      expect(entries[2]!.old_value).toEqual({ id: blockerId, name: 'the blocker' });
    });

    it('records the removal on the dependents when the blocker task is deleted', async () => {
      const taskId = await createTask('outlives its blocker');
      const untouched = await createTask('unrelated');
      const blockerId = await createTask('deleted blocker');

      await ctx
        .request(user.token)
        .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerId });
      await ctx.request(user.token).post(`/api/tasks/${blockerId}/archive`);
      expect((await ctx.request(user.token).delete(`/api/tasks/${blockerId}`)).status).toBe(204);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'blocker_added',
        'blocker_removed',
      ]);
      expect(entries[2]).toMatchObject({
        actor_user_id: user.id,
        old_value: { id: blockerId, name: 'deleted blocker' },
        new_value: null,
      });
      expect(await kinds(untouched)).toEqual(['created']);
    });

    it('leaves the blocker task’s own log untouched', async () => {
      const taskId = await createTask('dependent');
      const blockerId = await createTask('blocker with a clean log');

      await ctx
        .request(user.token)
        .post(`/api/tasks/${taskId}/blockers`, { blocker_task_id: blockerId });

      expect(await kinds(blockerId)).toEqual(['created']);
    });
  });

  describe('archive and restore', () => {
    it('records archiving and restoring once each, ignoring repeats', async () => {
      const taskId = await createTask('archivable');

      await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      await ctx.request(user.token).post(`/api/tasks/${taskId}/restore`);
      await ctx.request(user.token).post(`/api/tasks/${taskId}/restore`);

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual(['created', 'archived', 'restored']);
      expect(entries[1]).toMatchObject({
        actor_user_id: user.id,
        old_value: null,
        new_value: null,
      });
    });
  });

  describe('storage', () => {
    it('returns entries oldest first', async () => {
      const taskId = await createTask('ordered');
      await ctx.request(user.token).patch(`/api/tasks/${taskId}`, { title: 'renamed' });
      await ctx
        .request(user.token)
        .patch(`/api/tasks/${taskId}`, { column_id: otherColumnId, position: 2000 });

      const entries = await activity(taskId);
      expect(entries.map((entry) => entry.kind)).toEqual([
        'created',
        'title_changed',
        'column_changed',
      ]);
      const times = entries.map((entry) => Date.parse(entry.created_at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('cascades away with the task', async () => {
      const taskId = await createTask('doomed');
      expect(await activityRowCount(taskId)).toBe(1);

      await ctx.request(user.token).post(`/api/tasks/${taskId}/archive`);
      expect((await ctx.request(user.token).delete(`/api/tasks/${taskId}`)).status).toBe(204);

      expect(await activityRowCount(taskId)).toBe(0);
    });

    it('cascades away with the actor', async () => {
      const throwaway = newId();
      await db
        .insertInto('app_user')
        .values({
          id: throwaway,
          email: uniqueEmail('activity-throwaway'),
          password_hash: 'x',
          name: 'throwaway actor',
        })
        .execute();
      await db
        .insertInto('project_member')
        .values({ project_id: projectId, user_id: throwaway })
        .execute();
      const taskId = await createTask('outlives its actor');
      await recordTaskActivity(db, throwaway, [{ taskId, kind: 'archived' }]);
      expect(await activityRowCount(taskId)).toBe(2);

      await db.deleteFrom('app_user').where('id', '=', throwaway).execute();

      expect(await kinds(taskId)).toEqual(['created']);
    });

    it('rolls back with the transaction that wrote it', async () => {
      const taskId = await createTask('rolled back');
      const app = new Hono<{ Variables: Variables }>();
      app.use('*', transactionMiddleware);
      app.onError(errorHandler);
      app.post('/write-then-fail', async (c) => {
        await recordTaskActivity(c.get('db'), user.id, [
          { taskId, kind: 'title_changed', oldValue: { text: 'a' }, newValue: { text: 'b' } },
        ]);
        throw new Error('post-write failure');
      });

      const res = await app.request('/write-then-fail', { method: 'POST' });

      expect(res.status).toBe(500);
      expect(await kinds(taskId)).toEqual(['created']);
    });
  });

  async function activityRowCount(taskId: string): Promise<number> {
    const { count } = await db
      .selectFrom('task_activity')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task_id', '=', taskId)
      .executeTakeFirstOrThrow();
    return Number(count);
  }
});
