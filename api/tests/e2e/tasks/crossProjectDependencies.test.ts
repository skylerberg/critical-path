import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { newId, rankKey } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';

describe('GET /api/tasks/:id/cross-project-dependencies', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  let stranger: TestUser;
  let nearProject: string;
  let nearColumn: string;
  let farProject: string;
  let farTodo: string;
  let farDone: string;
  let hiddenProject: string;
  let hiddenColumn: string;
  let hiddenDone: string;

  beforeAll(async () => {
    user = await ctx.createUser('cross-project-deps');
    stranger = await ctx.createUser('cross-project-deps-stranger');
    nearProject = await fixtures.createProject('near', { createdBy: user.id });
    nearColumn = await fixtures.createColumn(nearProject);
    farProject = await fixtures.createProject('far', { createdBy: user.id });
    farTodo = await fixtures.createColumn(farProject, { name: 'To Do', sortKey: rankKey(1000) });
    farDone = await fixtures.createColumn(farProject, {
      name: 'Done',
      sortKey: rankKey(2000),
      isDone: true,
    });
    hiddenProject = await fixtures.createProject('hidden', { createdBy: stranger.id });
    hiddenColumn = await fixtures.createColumn(hiddenProject, {
      name: 'To Do',
      sortKey: rankKey(1000),
    });
    hiddenDone = await fixtures.createColumn(hiddenProject, {
      name: 'Done',
      sortKey: rankKey(2000),
      isDone: true,
    });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function createTask(
    owner: TestUser,
    projectId: string,
    columnId: string,
    title: string
  ): Promise<string> {
    const res = await ctx.request(owner.token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title,
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  async function fetchDeps(taskId: string, as: TestUser = user) {
    const res = await ctx.request(as.token).get(`/api/tasks/${taskId}/cross-project-dependencies`);
    return { status: res.status, body: await res.json(), raw: res };
  }

  it('requires auth', async () => {
    const res = await ctx.request().get(`/api/tasks/${newId()}/cross-project-dependencies`);
    expect(res.status).toBe(401);
  });

  it('404s for a task the caller cannot read', async () => {
    const theirs = await createTask(stranger, hiddenProject, hiddenColumn, 'theirs');
    const res = await ctx
      .request(user.token)
      .get(`/api/tasks/${theirs}/cross-project-dependencies`);
    expect(res.status).toBe(404);
  });

  it('is empty for a task with only same-project edges', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'local blocked');
    const blocker = await createTask(user, nearProject, nearColumn, 'local blocker');
    await ctx
      .request(user.token)
      .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });

    const { body } = await fetchDeps(blocked);
    expect(body).toEqual({
      blocked_by: [],
      blocking: [],
      hidden_blocked_by_count: 0,
      hidden_blocking_count: 0,
    });
  });

  it('names a readable blocker with its project and done state', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'named blocked');
    const blocker = await createTask(user, farProject, farTodo, 'named blocker');
    await ctx
      .request(user.token)
      .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });

    const { body } = await fetchDeps(blocked);
    expect(body.blocked_by).toEqual([
      {
        task_id: blocker,
        project_id: farProject,
        project_name: 'far',
        title: 'named blocker',
        is_done: false,
      },
    ]);
    expect(body.hidden_blocked_by_count).toBe(0);
  });

  it('reports the other direction, which no board payload hints at', async () => {
    const blocker = await createTask(user, nearProject, nearColumn, 'blocking blocker');
    const blocked = await createTask(user, farProject, farTodo, 'blocking blocked');
    await ctx
      .request(user.token)
      .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });

    const { body } = await fetchDeps(blocker);
    expect(body.blocked_by).toEqual([]);
    expect(body.blocking).toEqual([
      {
        task_id: blocked,
        project_id: farProject,
        project_name: 'far',
        title: 'blocking blocked',
        is_done: false,
      },
    ]);
  });

  it('keeps a done cross-project blocker listed, flagged rather than dropped', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'done-flag blocked');
    const blocker = await createTask(user, farProject, farTodo, 'done-flag blocker');
    await ctx
      .request(user.token)
      .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });
    await ctx
      .request(user.token)
      .patch(`/api/tasks/${blocker}`, { column_id: farDone, sort_key: rankKey(1000) });

    const { body } = await fetchDeps(blocked);
    expect(body.blocked_by).toHaveLength(1);
    expect(body.blocked_by[0].is_done).toBe(true);
  });

  it('drops an archived cross-project blocker entirely, matching blocker_ids', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'archived-far blocked');
    const blocker = await createTask(user, farProject, farTodo, 'archived-far blocker');
    await ctx
      .request(user.token)
      .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: blocker });
    await ctx.request(user.token).post(`/api/tasks/${blocker}/archive`, {});

    const { body } = await fetchDeps(blocked);
    expect(body.blocked_by).toEqual([]);
    expect(body.hidden_blocked_by_count).toBe(0);
  });

  it('reduces an unreadable blocker to a count and names nothing about it', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'hidden-blocker blocked');
    const secret = await createTask(stranger, hiddenProject, hiddenColumn, 'TOP SECRET BLOCKER');
    await fixtures.createDependencyRow(secret, blocked);

    const { body, raw } = await fetchDeps(blocked);
    expect(raw.status).toBe(200);
    expect(body).toEqual({
      blocked_by: [],
      blocking: [],
      hidden_blocked_by_count: 1,
      hidden_blocking_count: 0,
    });
  });

  it('reduces an unreadable dependent to a count and names nothing about it', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'hidden blocked');
    const secret = await createTask(stranger, hiddenProject, hiddenColumn, 'TOP SECRET TITLE');
    // Seeded directly: creating this edge needs someone who can read both
    // projects, and the state under test is what the surviving side sees after
    // that person's access to one of them goes away.
    await fixtures.createDependencyRow(blocked, secret);

    const { body, raw } = await fetchDeps(blocked);
    expect(body.blocking).toEqual([]);
    expect(body.hidden_blocking_count).toBe(1);
    // Asserted on the wire, not on parsed fields: the point is that no shape
    // exists that could carry the title at all.
    const text = JSON.stringify(body);
    expect(text).not.toContain('TOP SECRET TITLE');
    expect(text).not.toContain(hiddenProject);
    expect(text).not.toContain(secret);
    expect(raw.status).toBe(200);
  });

  it('reconciles the hidden blocked-by count with the board count', async () => {
    const blocked = await createTask(user, nearProject, nearColumn, 'reconcile blocked');
    const secretOpen = await createTask(stranger, hiddenProject, hiddenColumn, 'reconcile secret');
    const secretDone = await createTask(stranger, hiddenProject, hiddenDone, 'reconcile finished');
    await fixtures.createDependencyRow(secretOpen, blocked);
    await fixtures.createDependencyRow(secretDone, blocked);
    const readable = await createTask(user, farProject, farTodo, 'reconcile readable');
    // The board count is denormalized, and adding this edge through the route is
    // what recounts the two seeded ones along with it.
    await ctx
      .request(user.token)
      .post(`/api/tasks/${blocked}/blockers`, { blocker_task_id: readable });

    const { body } = await fetchDeps(blocked);
    expect(body.blocked_by).toEqual([
      {
        task_id: readable,
        project_id: farProject,
        project_name: 'far',
        title: 'reconcile readable',
        is_done: false,
      },
    ]);
    // One, not two: a done hidden blocker is left out of the count as well as
    // out of the list, so subtracting the two numbers cannot tell the caller
    // that a card they may not read has been finished.
    expect(body.hidden_blocked_by_count).toBe(1);

    const detail = await ctx.request(user.token).get(`/api/tasks/${blocked}`);
    expect((await detail.json()).open_cross_project_blocker_count).toBe(2);
  });
});
