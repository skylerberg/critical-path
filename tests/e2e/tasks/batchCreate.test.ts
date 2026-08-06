import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { newId } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';
import { TASK_TITLE_MAX_LENGTH } from '../../../src/schemas/tasks';
import { rankKey } from '../../helpers/fixtures';

interface BatchTask {
  id: string;
  column_id: string;
  title: string;
  description: unknown;
  sort_key: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  label_ids: string[];
  assignee_ids: string[];
  blocker_ids: string[];
  image_count: number;
  comment_count: number;
}

describe('POST /api/tasks/batch', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    user = await ctx.createUser('batch-create');
    projectId = await fixtures.createProject('batch create project', { createdBy: user.id });
    columnId = await fixtures.createColumn(projectId, { name: 'Backlog' });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  function item(title: string, rank: number, id = newId()) {
    return { id, title, sort_key: rankKey(rank) };
  }

  function batchBody(tasks: { id: string; title: string; position: number }[], overrides = {}) {
    return { project_id: projectId, column_id: columnId, tasks, ...overrides };
  }

  async function boardTaskIds(id = projectId, token = user.token): Promise<string[]> {
    const res = await ctx.request(token).get(`/api/projects/${id}`);
    expect(res.status).toBe(200);
    const board = (await res.json()) as { tasks: { id: string }[] };
    return board.tasks.map((task) => task.id);
  }

  it('requires auth', async () => {
    const res = await ctx.request().post('/api/tasks/batch', batchBody([item('One', 1000)]));
    expect(res.status).toBe(401);
  });

  it('creates every task in one request, in request order', async () => {
    const sent = [item('First', 9000), item('Second', 10000), item('Third', 11000)];
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(201);

    const { tasks } = (await res.json()) as { tasks: BatchTask[] };
    expect(tasks.map((task) => task.id)).toEqual(sent.map((task) => task.id));
    expect(tasks.map((task) => task.title)).toEqual(['First', 'Second', 'Third']);
    expect(tasks.map((task) => task.sort_key)).toEqual(
      [...tasks.map((task) => task.sort_key)].sort()
    );
    for (const task of tasks) {
      expect(task).toMatchObject({
        column_id: columnId,
        description: null,
        due_date: null,
        label_ids: [],
        assignee_ids: [],
        blocker_ids: [],
        image_count: 0,
        comment_count: 0,
      });
      expect(typeof task.created_at).toBe('string');
      expect(typeof task.updated_at).toBe('string');
      expect(task).not.toHaveProperty('project_id');
    }

    const onBoard = await boardTaskIds();
    for (const task of sent) {
      expect(onBoard).toContain(task.id);
    }
  });

  it('records a created activity entry for every task', async () => {
    const sent = [item('Logged one', 20000), item('Logged two', 21000)];
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(201);

    for (const task of sent) {
      const activityRes = await ctx.request(user.token).get(`/api/tasks/${task.id}/activity`);
      expect(activityRes.status).toBe(200);
      const { activity } = (await activityRes.json()) as {
        activity: { kind: string; actor_user_id: string; new_value: { text?: string } | null }[];
      };
      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({
        kind: 'created',
        actor_user_id: user.id,
        new_value: { text: task.title },
      });
    }
  });

  it('trims titles', async () => {
    const sent = [item('  padded  ', 30000)];
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(201);
    const { tasks } = (await res.json()) as { tasks: BatchTask[] };
    expect(tasks[0].title).toBe('padded');

    const detail = await ctx.request(user.token).get(`/api/tasks/${sent[0].id}`);
    expect((await detail.json()).title).toBe('padded');
  });

  it('rejects an empty tasks array', async () => {
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody([]));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.some((d: { path: string }) => d.path === 'tasks')).toBe(true);
  });

  it('rejects more than 100 tasks', async () => {
    const sent = Array.from({ length: 101 }, (_, i) => item(`Too many ${i}`, 40000 + i));
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(422);

    const onBoard = await boardTaskIds();
    expect(onBoard).not.toContain(sent[0].id);
  });

  it('accepts exactly 100 tasks', async () => {
    const project = await fixtures.createProject('batch cap project', { createdBy: user.id });
    const column = await fixtures.createColumn(project);
    const sent = Array.from({ length: 100 }, (_, i) => item(`Capped ${i}`, 1000 * (i + 1)));
    const res = await ctx
      .request(user.token)
      .post('/api/tasks/batch', batchBody(sent, { project_id: project, column_id: column }));
    expect(res.status).toBe(201);
    const { tasks } = (await res.json()) as { tasks: BatchTask[] };
    expect(tasks).toHaveLength(100);
    expect(await boardTaskIds(project)).toHaveLength(100);
  });

  it('rejects a blank title', async () => {
    const sent = [item('Fine', 50000), item('   ', 51000)];
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.details.some((d: { path: string }) => d.path === 'tasks.1.title')).toBe(true);

    expect(await boardTaskIds()).not.toContain(sent[0].id);
  });

  it('stores a title at the maximum length whole and rejects one character more', async () => {
    const title = 'z'.repeat(TASK_TITLE_MAX_LENGTH);
    const accepted = await ctx
      .request(user.token)
      .post('/api/tasks/batch', batchBody([item(title, 60000)]));
    expect(accepted.status).toBe(201);
    const { tasks } = (await accepted.json()) as { tasks: BatchTask[] };
    expect(tasks[0].title).toBe(title);

    const sent = [item('Fine', 61000), item('z'.repeat(TASK_TITLE_MAX_LENGTH + 1), 62000)];
    const rejected = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(rejected.status).toBe(422);
    expect(
      ((await rejected.json()).details as { path: string }[]).some(
        (d) => d.path === 'tasks.1.title'
      )
    ).toBe(true);
    expect(await boardTaskIds()).not.toContain(sent[0].id);
  });

  it('returns 404 for an unknown or inaccessible project', async () => {
    const unknown = await ctx
      .request(user.token)
      .post(
        '/api/tasks/batch',
        batchBody([item('Nowhere', 1000)], { project_id: newId(), column_id: newId() })
      );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toBe('Project not found');

    const outsider = await ctx.createUser('batch-create-outsider');
    const foreignProject = await fixtures.createProject('someone else', {
      createdBy: outsider.id,
    });
    const foreignColumn = await fixtures.createColumn(foreignProject);
    const inaccessible = await ctx.request(user.token).post(
      '/api/tasks/batch',
      batchBody([item('Not mine', 1000)], {
        project_id: foreignProject,
        column_id: foreignColumn,
      })
    );
    expect(inaccessible.status).toBe(404);
    expect((await inaccessible.json()).error).toBe('Project not found');
  });

  it('rejects a column from another project with 422', async () => {
    const otherProject = await fixtures.createProject('batch other project', {
      createdBy: user.id,
    });
    const otherColumn = await fixtures.createColumn(otherProject);
    const res = await ctx
      .request(user.token)
      .post(
        '/api/tasks/batch',
        batchBody([item('Wrong column', 1000)], { column_id: otherColumn })
      );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain('column_id');
  });

  it('returns 409 and creates nothing when an id is already in use', async () => {
    const existing = await fixtures.createTaskRow(projectId, columnId, 'already here');
    const sent = [item('Before', 60000), item('Clash', 61000, existing), item('After', 62000)];
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Task id already in use');

    const onBoard = await boardTaskIds();
    expect(onBoard).not.toContain(sent[0].id);
    expect(onBoard).not.toContain(sent[2].id);

    const kept = await ctx.request(user.token).get(`/api/tasks/${existing}`);
    expect((await kept.json()).title).toBe('already here');
  });

  it('returns 409 when the same id appears twice in one batch', async () => {
    const repeated = newId();
    const sent = [
      item('Twin one', 70000, repeated),
      item('Twin two', 71000, repeated),
      item('Bystander', 72000),
    ];
    const res = await ctx.request(user.token).post('/api/tasks/batch', batchBody(sent));
    expect(res.status).toBe(409);

    const onBoard = await boardTaskIds();
    expect(onBoard).not.toContain(repeated);
    expect(onBoard).not.toContain(sent[2].id);
  });

  it('accepts a batch from a project member who is not the creator', async () => {
    const member = await ctx.createUser('batch-create-member');
    const shared = await fixtures.createProject('batch shared project', {
      createdBy: user.id,
      memberIds: [member.id],
    });
    const sharedColumn = await fixtures.createColumn(shared);
    const sent = [item('Member made', 1000), item('Member made too', 2000)];
    const res = await ctx
      .request(member.token)
      .post('/api/tasks/batch', batchBody(sent, { project_id: shared, column_id: sharedColumn }));
    expect(res.status).toBe(201);
    expect(await boardTaskIds(shared, member.token)).toHaveLength(2);
  });
});
