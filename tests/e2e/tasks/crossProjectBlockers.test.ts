import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { newId, rankKey } from '../../helpers/fixtures';
import { ProjectFixtures } from './taskFixtures';

// One user owning both projects throughout: the access rules have their own
// file, and mixing them in here would hide which assertion is about the count.
describe('Cross-project blocker counts', () => {
  const ctx = new TestContext();
  const fixtures = new ProjectFixtures();
  let user: TestUser;
  // "near" holds the blocked task; "far" holds the blocker.
  let nearProject: string;
  let nearColumn: string;
  let farProject: string;
  let farTodo: string;
  let farDone: string;

  beforeAll(async () => {
    user = await ctx.createUser('cross-project-blockers');
    nearProject = await fixtures.createProject('near project', { createdBy: user.id });
    nearColumn = await fixtures.createColumn(nearProject);
    farProject = await fixtures.createProject('far project', { createdBy: user.id });
    farTodo = await fixtures.createColumn(farProject, { name: 'To Do', sortKey: rankKey(1000) });
    farDone = await fixtures.createColumn(farProject, {
      name: 'Done',
      sortKey: rankKey(2000),
      isDone: true,
    });
  });

  afterAll(async () => {
    await fixtures.cleanup();
    await ctx.cleanup();
  });

  async function createTask(projectId: string, columnId: string, title: string): Promise<string> {
    const res = await ctx.request(user.token).post('/api/tasks', {
      id: newId(),
      project_id: projectId,
      column_id: columnId,
      title,
      sort_key: rankKey(1000),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as string;
  }

  async function block(blockedId: string, blockerId: string): Promise<void> {
    const res = await ctx
      .request(user.token)
      .post(`/api/tasks/${blockedId}/blockers`, { blocker_task_id: blockerId });
    expect(res.status).toBe(204);
  }

  async function countOf(taskId: string): Promise<number> {
    const res = await ctx.request(user.token).get(`/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    return (await res.json()).open_cross_project_blocker_count as number;
  }

  // The count has to be right on the board read too, not just the task detail:
  // the board is the surface that pays for the denormalization.
  async function boardCountOf(taskId: string): Promise<number> {
    const res = await ctx.request(user.token).get(`/api/projects/${nearProject}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const task = body.tasks.find((candidate: { id: string }) => candidate.id === taskId);
    return task.open_cross_project_blocker_count as number;
  }

  async function pair(title: string): Promise<{ blocked: string; blocker: string }> {
    const blocked = await createTask(nearProject, nearColumn, `${title} blocked`);
    const blocker = await createTask(farProject, farTodo, `${title} blocker`);
    await block(blocked, blocker);
    return { blocked, blocker };
  }

  it('counts an open cross-project blocker on the board payload', async () => {
    const { blocked } = await pair('basic');
    expect(await countOf(blocked)).toBe(1);
    expect(await boardCountOf(blocked)).toBe(1);
  });

  it('clears when the blocker moves into a done column, and returns when it moves back', async () => {
    const { blocked, blocker } = await pair('move');

    const done = await ctx
      .request(user.token)
      .patch(`/api/tasks/${blocker}`, { column_id: farDone, sort_key: rankKey(1000) });
    expect(done.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);

    const undone = await ctx
      .request(user.token)
      .patch(`/api/tasks/${blocker}`, { column_id: farTodo, sort_key: rankKey(3000) });
    expect(undone.status).toBe(200);
    expect(await countOf(blocked)).toBe(1);
  });

  it('clears when the blocker is archived and returns when it is restored', async () => {
    const { blocked, blocker } = await pair('archive');

    expect((await ctx.request(user.token).post(`/api/tasks/${blocker}/archive`, {})).status).toBe(
      200
    );
    expect(await countOf(blocked)).toBe(0);

    expect((await ctx.request(user.token).post(`/api/tasks/${blocker}/restore`, {})).status).toBe(
      200
    );
    expect(await countOf(blocked)).toBe(1);
  });

  it('clears when the blocker is deleted', async () => {
    const { blocked, blocker } = await pair('delete');

    await ctx.request(user.token).post(`/api/tasks/${blocker}/archive`, {});
    expect((await ctx.request(user.token).delete(`/api/tasks/${blocker}`)).status).toBe(204);
    expect(await countOf(blocked)).toBe(0);
  });

  it('clears when the blocker is removed as an edge', async () => {
    const { blocked, blocker } = await pair('unblock');

    const res = await ctx.request(user.token).delete(`/api/tasks/${blocked}/blockers/${blocker}`);
    expect(res.status).toBe(204);
    expect(await countOf(blocked)).toBe(0);
  });

  it('follows the done flag of the blocker’s column being flipped', async () => {
    const { blocked, blocker } = await pair('flip');
    const column = await fixtures.createColumn(farProject, {
      name: 'Flip',
      sortKey: rankKey(4000),
    });
    await ctx
      .request(user.token)
      .patch(`/api/tasks/${blocker}`, { column_id: column, sort_key: rankKey(1000) });
    expect(await countOf(blocked)).toBe(1);

    const flipped = await ctx
      .request(user.token)
      .patch(`/api/columns/${column}`, { is_done: true });
    expect(flipped.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);

    const unflipped = await ctx
      .request(user.token)
      .patch(`/api/columns/${column}`, { is_done: false });
    expect(unflipped.status).toBe(200);
    expect(await countOf(blocked)).toBe(1);
  });

  it('follows a bulk move of the blocker into a done column', async () => {
    const { blocked, blocker } = await pair('bulk move');

    const res = await ctx.request(user.token).post('/api/tasks/bulk-move', {
      project_id: farProject,
      column_id: farDone,
      task_ids: [blocker],
    });
    expect(res.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);
  });

  it('follows a bulk archive of the blocker', async () => {
    const { blocked, blocker } = await pair('bulk archive');

    const res = await ctx
      .request(user.token)
      .post('/api/tasks/bulk-archive', { project_id: farProject, task_ids: [blocker] });
    expect(res.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);
  });

  it('follows the blocker’s whole column being archived', async () => {
    const column = await fixtures.createColumn(farProject, {
      name: 'Archive me',
      sortKey: rankKey(5000),
    });
    const blocked = await createTask(nearProject, nearColumn, 'column archive blocked');
    const blocker = await createTask(farProject, column, 'column archive blocker');
    await block(blocked, blocker);
    expect(await countOf(blocked)).toBe(1);

    const res = await ctx.request(user.token).post(`/api/columns/${column}/archive-tasks`, {});
    expect(res.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);
  });

  it('follows the blocker’s column being deleted into a done column', async () => {
    const column = await fixtures.createColumn(farProject, {
      name: 'Delete me',
      sortKey: rankKey(6000),
    });
    const blocked = await createTask(nearProject, nearColumn, 'column delete blocked');
    const blocker = await createTask(farProject, column, 'column delete blocker');
    await block(blocked, blocker);

    const res = await ctx
      .request(user.token)
      .delete(`/api/columns/${column}?move_tasks_to=${farDone}`);
    expect(res.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);
  });

  it('follows a whole column of blockers being moved into a done column', async () => {
    const column = await fixtures.createColumn(farProject, {
      name: 'Move me',
      sortKey: rankKey(7000),
    });
    const blocked = await createTask(nearProject, nearColumn, 'column move blocked');
    const blocker = await createTask(farProject, column, 'column move blocker');
    await block(blocked, blocker);

    const res = await ctx
      .request(user.token)
      .post(`/api/columns/${column}/move-tasks`, { target_column_id: farDone });
    expect(res.status).toBe(200);
    expect(await countOf(blocked)).toBe(0);
  });

  it('clears when the blocker’s whole project is deleted', async () => {
    const doomed = await fixtures.createProject('doomed project', { createdBy: user.id });
    const doomedColumn = await fixtures.createColumn(doomed);
    const blocked = await createTask(nearProject, nearColumn, 'project delete blocked');
    const blocker = await createTask(doomed, doomedColumn, 'project delete blocker');
    await block(blocked, blocker);
    expect(await countOf(blocked)).toBe(1);

    const res = await ctx.request(user.token).delete(`/api/projects/${doomed}`);
    expect(res.status).toBe(204);
    expect(await countOf(blocked)).toBe(0);
  });

  it('counts a cross-project blocker as exactly one and never expands what blocks it', async () => {
    // far2 blocks far1 blocks near. Depth stops at the boundary: near sees one.
    const far1 = await createTask(farProject, farTodo, 'depth first');
    const far2 = await createTask(farProject, farTodo, 'depth second');
    await block(far1, far2);
    const blocked = await createTask(nearProject, nearColumn, 'depth blocked');
    await block(blocked, far1);

    expect(await countOf(blocked)).toBe(1);
    const detail = await ctx.request(user.token).get(`/api/tasks/${blocked}`);
    expect((await detail.json()).blocker_ids).toEqual([]);
  });

  it('keeps local and cross-project blockers on separate books', async () => {
    const localBlocker = await createTask(nearProject, nearColumn, 'local blocker');
    const farBlocker = await createTask(farProject, farTodo, 'far blocker');
    const blocked = await createTask(nearProject, nearColumn, 'mixed blocked');
    await block(blocked, localBlocker);
    await block(blocked, farBlocker);

    const detail = await ctx.request(user.token).get(`/api/tasks/${blocked}`);
    const body = await detail.json();
    expect(body.blocker_ids).toEqual([localBlocker]);
    expect(body.open_cross_project_blocker_count).toBe(1);
  });
});
