import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';
import { subscribeBus, type BusEntry } from '../../../src/services/realtime/bus';
import { notificationDelivery } from '../../../src/services/notifications';

interface MovedTask {
  id: string;
  column_id: string;
  position: number;
}

interface Relations {
  task_id: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
}

interface TaskRow {
  column_id: string;
  position: number;
  title: string;
  archived_at: Date | null;
  column_since: Date;
}

const PER_TASK_TYPES = ['task_updated', 'task_archived', 'task_deleted', 'task_relations_set'];

describe('Bulk actions on a selection', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let owner: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let todo: string;
  let doing: string;
  let labelId: string;
  let otherProjectId: string;
  let otherColumnId: string;

  beforeAll(async () => {
    owner = await ctx.createUser('bulk-owner');
    viewer = await ctx.createUser('bulk-viewer');
    outsider = await ctx.createUser('bulk-outsider');
    projectId = await fixtures.createProject('bulk e2e project', { createdBy: owner.id });
    await db
      .insertInto('project_member')
      .values({ project_id: projectId, user_id: viewer.id, role: 'viewer' })
      .execute();
    todo = await fixtures.createColumn(projectId, { name: 'Todo', position: 1000 });
    doing = await fixtures.createColumn(projectId, { name: 'Doing', position: 2000 });
    labelId = await fixtures.createLabel(projectId, 'art');
    otherProjectId = await fixtures.createProject('bulk other project', { createdBy: outsider.id });
    otherColumnId = await fixtures.createColumn(otherProjectId, { name: 'Elsewhere' });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  function post(path: string, body: unknown, token: string | null = owner.token) {
    return ctx.request(token ?? undefined).post(`/api/tasks/${path}`, body);
  }

  async function seed(count: number, columnId = todo, titlePrefix = 'card'): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      ids.push(
        await fixtures.createTaskRow(projectId, columnId, `${titlePrefix} ${String(i)}`, {
          position: (i + 1) * 1000,
        })
      );
    }
    return ids;
  }

  async function taskRow(taskId: string): Promise<TaskRow | undefined> {
    return db
      .selectFrom('task')
      .select(['column_id', 'position', 'title', 'archived_at', 'column_since'])
      .where('id', '=', taskId)
      .executeTakeFirst();
  }

  async function labelIdsOf(taskId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('task_label')
      .select('label_id')
      .where('task_id', '=', taskId)
      .orderBy('label_id')
      .execute();
    return rows.map((row) => row.label_id);
  }

  async function assigneeIdsOf(taskId: string): Promise<string[]> {
    const rows = await db
      .selectFrom('task_assignee')
      .select('user_id')
      .where('task_id', '=', taskId)
      .orderBy('user_id')
      .execute();
    return rows.map((row) => row.user_id);
  }

  async function activityOf(taskId: string): Promise<Array<{ kind: string; old: unknown }>> {
    const rows = await db
      .selectFrom('task_activity')
      .select(['kind', 'old_value', 'new_value'])
      .where('task_id', '=', taskId)
      .orderBy('created_at')
      .orderBy('seq')
      .execute();
    return rows.map((row) => ({ kind: row.kind, old: row.old_value ?? row.new_value }));
  }

  async function captureBus<T>(run: () => Promise<T>): Promise<{ result: T; seen: BusEntry[] }> {
    const seen: BusEntry[] = [];
    const unsubscribe = subscribeBus((entry) => seen.push(entry));
    try {
      return { result: await run(), seen };
    } finally {
      unsubscribe();
    }
  }

  // The four routes and a body that would succeed, so a rejection can only come
  // from the check under test.
  function routes(ids: string[]): Array<{ path: string; body: Record<string, unknown> }> {
    return [
      { path: 'bulk-move', body: { task_ids: ids, column_id: doing } },
      { path: 'bulk-archive', body: { task_ids: ids } },
      { path: 'bulk-labels', body: { task_ids: ids, add_label_ids: [labelId] } },
      { path: 'bulk-assignees', body: { task_ids: ids, add_user_ids: [owner.id] } },
    ];
  }

  describe('access control', () => {
    it('rejects an unauthenticated caller on every route', async () => {
      for (const route of routes([newId()])) {
        const res = await post(route.path, { project_id: projectId, ...route.body }, null);
        expect([route.path, res.status]).toEqual([route.path, 401]);
      }
    });

    it('answers 404 for an unknown project on every route', async () => {
      for (const route of routes([newId()])) {
        const res = await post(route.path, { project_id: newId(), ...route.body });
        expect([route.path, res.status]).toEqual([route.path, 404]);
      }
    });

    it('answers 404, not 403, for a project the caller cannot see', async () => {
      for (const route of routes([newId()])) {
        const res = await post(
          route.path,
          { project_id: otherProjectId, ...route.body, column_id: otherColumnId },
          owner.token
        );
        expect([route.path, res.status]).toEqual([route.path, 404]);
      }
    });

    it('answers 403 for a viewer on every route', async () => {
      const ids = await seed(1);
      for (const route of routes(ids)) {
        const res = await post(route.path, { project_id: projectId, ...route.body }, viewer.token);
        expect([route.path, res.status]).toEqual([route.path, 403]);
      }
      expect((await taskRow(ids[0]!))?.column_id).toBe(todo);
    });

    it('skips a task id from another project and leaves that row untouched', async () => {
      const foreign = await fixtures.createTaskRow(otherProjectId, otherColumnId, 'not yours');
      await db
        .insertInto('task_assignee')
        .values({ task_id: foreign, user_id: outsider.id })
        .execute();
      const before = await taskRow(foreign);

      for (const route of routes([foreign])) {
        const res = await post(route.path, { project_id: projectId, ...route.body });
        expect([route.path, res.status]).toEqual([route.path, 200]);
        const body = (await res.json()) as { skipped_task_ids: string[] };
        expect(body.skipped_task_ids).toEqual([foreign]);
      }

      expect(await taskRow(foreign)).toEqual(before);
      expect(await assigneeIdsOf(foreign)).toEqual([outsider.id]);
      expect(await labelIdsOf(foreign)).toEqual([]);
    });

    it('skips an unknown id exactly as it skips a foreign one', async () => {
      const unknown = newId();
      for (const route of routes([unknown])) {
        const res = await post(route.path, { project_id: projectId, ...route.body });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { skipped_task_ids: string[] }).skipped_task_ids).toEqual([
          unknown,
        ]);
      }
    });
  });

  describe('request contract', () => {
    it('rejects an empty id list on every route', async () => {
      for (const route of routes([])) {
        const res = await post(route.path, { project_id: projectId, ...route.body });
        expect([route.path, res.status]).toEqual([route.path, 422]);
      }
    });

    it('rejects more than 100 ids on every route', async () => {
      const ids = Array.from({ length: 101 }, () => newId());
      for (const route of routes(ids)) {
        const res = await post(route.path, { project_id: projectId, ...route.body });
        expect([route.path, res.status]).toEqual([route.path, 422]);
      }
    });

    it('dedupes a repeated id and applies it once', async () => {
      const [id] = await seed(1);
      const res = await post('bulk-labels', {
        project_id: projectId,
        task_ids: [id, id, id],
        add_label_ids: [labelId],
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tasks: Relations[]; skipped_task_ids: string[] };
      expect(body.tasks.map((task) => task.task_id)).toEqual([id]);
      expect(body.skipped_task_ids).toEqual([]);
      expect(await labelIdsOf(id!)).toEqual([labelId]);
      expect((await activityOf(id!)).filter((entry) => entry.kind === 'label_added')).toHaveLength(
        1
      );
    });

    it('publishes nothing when every id was skipped', async () => {
      const gone = [newId(), newId()];
      for (const route of routes(gone)) {
        const { result, seen } = await captureBus(() =>
          post(route.path, { project_id: projectId, ...route.body })
        );
        expect(result.status).toBe(200);
        const body = (await result.json()) as Record<string, unknown>;
        expect(body.skipped_task_ids).toEqual(gone);
        for (const key of ['moved_tasks', 'tasks']) {
          if (key in body) expect(body[key]).toEqual([]);
        }
        expect(seen).toEqual([]);
      }
    });
  });

  describe('bulk-move', () => {
    it('appends in request order above the target’s max, archived rows included', async () => {
      const ids = await seed(3);
      const parked = await fixtures.createTaskRow(projectId, doing, 'archived squatter', {
        position: 99_000,
        archivedAt: new Date(),
      });
      const requested = [ids[2]!, ids[0]!, ids[1]!];

      const res = await post('bulk-move', {
        project_id: projectId,
        task_ids: requested,
        column_id: doing,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { moved_tasks: MovedTask[]; skipped_task_ids: string[] };
      expect(body.moved_tasks.map((task) => task.id)).toEqual(requested);
      expect(body.skipped_task_ids).toEqual([]);
      const positions = body.moved_tasks.map((task) => task.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(Math.min(...positions)).toBeGreaterThan(99_000);
      expect((await taskRow(parked))?.position).toBe(99_000);
    });

    it('skips archived ids and moves the rest', async () => {
      const [live] = await seed(1);
      const archived = await fixtures.createTaskRow(projectId, todo, 'already gone', {
        archivedAt: new Date(),
      });

      const res = await post('bulk-move', {
        project_id: projectId,
        task_ids: [live!, archived],
        column_id: doing,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { moved_tasks: MovedTask[]; skipped_task_ids: string[] };
      expect(body.moved_tasks.map((task) => task.id)).toEqual([live]);
      expect(body.skipped_task_ids).toEqual([archived]);
      expect((await taskRow(archived))?.column_id).toBe(todo);
    });

    it('answers 422, never 500, for a column in another project', async () => {
      const ids = await seed(1);

      const res = await post('bulk-move', {
        project_id: projectId,
        task_ids: ids,
        column_id: otherColumnId,
      });

      expect(res.status).toBe(422);
      expect((await taskRow(ids[0]!))?.column_id).toBe(todo);
    });

    it('validates the column even when every id was skipped', async () => {
      const res = await post('bulk-move', {
        project_id: projectId,
        task_ids: [newId()],
        column_id: otherColumnId,
      });

      expect(res.status).toBe(422);
    });

    it('re-stamps a card already in the target without moving or logging it', async () => {
      const [mover] = await seed(1);
      const resident = await fixtures.createTaskRow(projectId, doing, 'already there', {
        position: 500,
      });
      const before = await taskRow(resident);

      const res = await post('bulk-move', {
        project_id: projectId,
        task_ids: [mover!, resident],
        column_id: doing,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { moved_tasks: MovedTask[] };
      expect(body.moved_tasks.map((task) => task.id)).toEqual([mover, resident]);
      const after = await taskRow(resident);
      expect(after?.position).toBeGreaterThan(before!.position);
      expect(after?.column_since.getTime()).toBe(before!.column_since.getTime());
      expect(await activityOf(resident)).toEqual([]);
      expect(await activityOf(mover!)).toEqual([
        { kind: 'column_changed', old: { id: todo, name: 'Todo' } },
      ]);
    });

    it('names each card’s own source column across a multi-column selection', async () => {
      const [fromTodo] = await seed(1);
      const third = await fixtures.createColumn(projectId, { name: 'Blocked', position: 3000 });
      const fromBlocked = await fixtures.createTaskRow(projectId, third, 'blocked one');

      const res = await post('bulk-move', {
        project_id: projectId,
        task_ids: [fromTodo!, fromBlocked],
        column_id: doing,
      });

      expect(res.status).toBe(200);
      expect(await activityOf(fromTodo!)).toEqual([
        { kind: 'column_changed', old: { id: todo, name: 'Todo' } },
      ]);
      expect(await activityOf(fromBlocked)).toEqual([
        { kind: 'column_changed', old: { id: third, name: 'Blocked' } },
      ]);
    });

    it('publishes exactly one bulk_tasks_moved and no per-task event', async () => {
      const ids = await seed(2);

      const { seen } = await captureBus(() =>
        post('bulk-move', { project_id: projectId, task_ids: ids, column_id: doing })
      );

      const bulk = seen.filter((entry) => entry.type === 'bulk_tasks_moved');
      expect(bulk).toHaveLength(1);
      expect((bulk[0]!.data as { moved_tasks: MovedTask[] }).moved_tasks.map((t) => t.id)).toEqual(
        ids
      );
      expect(seen.filter((entry) => PER_TASK_TYPES.includes(entry.type))).toEqual([]);
    });
  });

  describe('bulk-archive', () => {
    it('archives the batch under one stamp and logs one entry per card', async () => {
      const ids = await seed(3);

      const res = await post('bulk-archive', { project_id: projectId, task_ids: ids });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        tasks: Array<{ id: string; archived_at: string }>;
        skipped_task_ids: string[];
      };
      expect(body.tasks.map((task) => task.id).sort()).toEqual([...ids].sort());
      expect(body.skipped_task_ids).toEqual([]);
      expect(new Set(body.tasks.map((task) => task.archived_at)).size).toBe(1);
      for (const id of ids) {
        expect((await activityOf(id)).map((entry) => entry.kind)).toEqual(['archived']);
      }
    });

    it('skips an already archived id, keeps its stamp, and repeats as a no-op', async () => {
      const ids = await seed(2);
      const first = await post('bulk-archive', { project_id: projectId, task_ids: ids });
      expect(first.status).toBe(200);
      const stamp = (await taskRow(ids[0]!))?.archived_at;

      const { result, seen } = await captureBus(() =>
        post('bulk-archive', { project_id: projectId, task_ids: ids })
      );

      expect(result.status).toBe(200);
      const body = (await result.json()) as { tasks: unknown[]; skipped_task_ids: string[] };
      expect(body.tasks).toEqual([]);
      expect(body.skipped_task_ids).toEqual(ids);
      expect((await taskRow(ids[0]!))?.archived_at?.getTime()).toBe(stamp?.getTime());
      expect(seen).toEqual([]);
    });

    it('publishes exactly one bulk_tasks_archived and no per-task event', async () => {
      const ids = await seed(2);

      const { seen } = await captureBus(() =>
        post('bulk-archive', { project_id: projectId, task_ids: ids })
      );

      const bulk = seen.filter((entry) => entry.type === 'bulk_tasks_archived');
      expect(bulk).toHaveLength(1);
      expect(
        (bulk[0]!.data as { tasks: Array<{ id: string }> }).tasks.map((task) => task.id).sort()
      ).toEqual([...ids].sort());
      expect(seen.filter((entry) => PER_TASK_TYPES.includes(entry.type))).toEqual([]);
    });
  });

  describe('bulk-labels', () => {
    it('adds across the selection and is idempotent on a second call', async () => {
      const ids = await seed(2);

      const first = await post('bulk-labels', {
        project_id: projectId,
        task_ids: ids,
        add_label_ids: [labelId],
      });
      expect(first.status).toBe(200);
      expect(((await first.json()) as { tasks: Relations[] }).tasks.map((t) => t.task_id)).toEqual(
        ids
      );

      const { result, seen } = await captureBus(() =>
        post('bulk-labels', { project_id: projectId, task_ids: ids, add_label_ids: [labelId] })
      );
      expect(result.status).toBe(200);
      expect(((await result.json()) as { tasks: Relations[] }).tasks).toEqual([]);
      expect(seen).toEqual([]);
      for (const id of ids) {
        expect(await labelIdsOf(id)).toEqual([labelId]);
        expect((await activityOf(id)).filter((e) => e.kind === 'label_added')).toHaveLength(1);
      }
    });

    it('adds and removes in one call and reports the full relation sets', async () => {
      const ids = await seed(2);
      const other = await fixtures.createLabel(projectId, `bug ${newId().slice(0, 8)}`);
      await db
        .insertInto('task_label')
        .values(ids.map((task_id) => ({ task_id, label_id: other })))
        .execute();

      const res = await post('bulk-labels', {
        project_id: projectId,
        task_ids: ids,
        add_label_ids: [labelId],
        remove_label_ids: [other],
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tasks: Relations[] };
      expect(body.tasks.map((task) => task.label_ids)).toEqual([[labelId], [labelId]]);
      expect(body.tasks[0]).toEqual({
        task_id: ids[0],
        label_ids: [labelId],
        assignee_ids: [],
        blocker_ids: [],
      });
      expect((await activityOf(ids[0]!)).map((entry) => entry.kind)).toEqual([
        'label_removed',
        'label_added',
      ]);
    });

    it('rejects a label from another project and writes nothing', async () => {
      const ids = await seed(1);
      const foreignLabel = await fixtures.createLabel(otherProjectId, 'theirs');

      const res = await post('bulk-labels', {
        project_id: projectId,
        task_ids: ids,
        add_label_ids: [foreignLabel],
      });

      expect(res.status).toBe(422);
      expect(await labelIdsOf(ids[0]!)).toEqual([]);
    });

    it('rejects an empty delta and an overlapping one', async () => {
      const ids = await seed(1);

      const empty = await post('bulk-labels', { project_id: projectId, task_ids: ids });
      expect(empty.status).toBe(422);

      const overlapping = await post('bulk-labels', {
        project_id: projectId,
        task_ids: ids,
        add_label_ids: [labelId],
        remove_label_ids: [labelId],
      });
      expect(overlapping.status).toBe(422);
      expect(await labelIdsOf(ids[0]!)).toEqual([]);
    });

    it('publishes exactly one bulk_tasks_relations_set and no per-task event', async () => {
      const ids = await seed(2);

      const { seen } = await captureBus(() =>
        post('bulk-labels', { project_id: projectId, task_ids: ids, add_label_ids: [labelId] })
      );

      const bulk = seen.filter((entry) => entry.type === 'bulk_tasks_relations_set');
      expect(bulk).toHaveLength(1);
      expect((bulk[0]!.data as { tasks: Relations[] }).tasks.map((task) => task.task_id)).toEqual(
        ids
      );
      expect(seen.filter((entry) => PER_TASK_TYPES.includes(entry.type))).toEqual([]);
    });
  });

  describe('bulk-assignees', () => {
    it('adds and removes across the selection, logging only what changed', async () => {
      const ids = await seed(2);
      await db
        .insertInto('task_assignee')
        .values({ task_id: ids[0]!, user_id: owner.id })
        .execute();

      const res = await post('bulk-assignees', {
        project_id: projectId,
        task_ids: ids,
        add_user_ids: [owner.id],
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { tasks: Relations[] };
      expect(body.tasks.map((task) => task.task_id)).toEqual([ids[1]]);
      expect(await assigneeIdsOf(ids[0]!)).toEqual([owner.id]);
      expect(await activityOf(ids[0]!)).toEqual([]);
      expect((await activityOf(ids[1]!)).map((entry) => entry.kind)).toEqual(['assignee_added']);

      const removal = await post('bulk-assignees', {
        project_id: projectId,
        task_ids: ids,
        remove_user_ids: [owner.id],
      });
      expect(removal.status).toBe(200);
      expect(await assigneeIdsOf(ids[0]!)).toEqual([]);
    });

    it('rejects a user without project access and writes nothing', async () => {
      const ids = await seed(1);

      const res = await post('bulk-assignees', {
        project_id: projectId,
        task_ids: ids,
        add_user_ids: [outsider.id],
      });

      expect(res.status).toBe(422);
      expect(await assigneeIdsOf(ids[0]!)).toEqual([]);
    });

    it('rejects an empty delta and an overlapping one', async () => {
      const ids = await seed(1);

      expect((await post('bulk-assignees', { project_id: projectId, task_ids: ids })).status).toBe(
        422
      );
      const overlapping = await post('bulk-assignees', {
        project_id: projectId,
        task_ids: ids,
        add_user_ids: [viewer.id],
        remove_user_ids: [viewer.id],
      });
      expect(overlapping.status).toBe(422);
      expect(await assigneeIdsOf(ids[0]!)).toEqual([]);
    });

    it('notifies nobody, and publishes one relations event with no per-task event', async () => {
      const ids = await seed(2);
      const deliver = vi.spyOn(notificationDelivery, 'deliver').mockResolvedValue(undefined);

      const { seen } = await captureBus(() =>
        post('bulk-assignees', {
          project_id: projectId,
          task_ids: ids,
          add_user_ids: [viewer.id],
        })
      );

      expect(deliver).not.toHaveBeenCalled();
      deliver.mockRestore();
      expect(seen.filter((entry) => entry.type === 'bulk_tasks_relations_set')).toHaveLength(1);
      expect(seen.filter((entry) => PER_TASK_TYPES.includes(entry.type))).toEqual([]);
    });
  });
});
