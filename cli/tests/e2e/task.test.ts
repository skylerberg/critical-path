import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type BoardTask = components['schemas']['BoardTask'];
type TaskDetailResponse = components['schemas']['TaskDetailResponse'];
type StatefulTask = BoardTask & { state: string };

describe('task commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let backlogId: string;
  let todoId: string;
  let doneId: string;
  let alpha: BoardTask;
  let beta: BoardTask;
  let gamma: BoardTask;
  let delta: BoardTask;
  let epsilon: BoardTask;
  const blockerWorkId = crypto.randomUUID();
  const blockedWorkId = crypto.randomUUID();
  const finishedWorkId = crypto.randomUUID();

  beforeAll(async () => {
    user = await tc.createUser('cli-task');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await tc.request(user.token).post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Task Fixture',
    });
    expect(create.status).toBe(201);
    const board = (await create.json()) as BoardPayload;
    projectId = board.project.id;
    const columns = [...board.columns].sort((a, b) => a.position - b.position);
    backlogId = columns[0].id;
    todoId = columns[1].id;
    doneId = columns.find((c) => c.is_done)!.id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('create defaults to the first non-done column and honors placement flags', async () => {
    const a = await h.runCli(['task', 'create', 'Alpha task', '--project', projectId, '--json']);
    expect(a.exitCode).toBe(0);
    alpha = a.json<BoardTask>();
    expect(alpha.column_id).toBe(backlogId);
    expect(alpha.position).toBe(1000);

    const b = await h.runCli(['task', 'create', 'Beta task', '--project', projectId, '--json']);
    beta = b.json<BoardTask>();
    expect(beta.position).toBe(2000);

    const c = await h.runCli([
      'task',
      'create',
      'Gamma task',
      '--project',
      projectId,
      '--top',
      '--json',
    ]);
    gamma = c.json<BoardTask>();
    expect(gamma.position).toBe(0);

    const d = await h.runCli([
      'task',
      'create',
      'Delta task',
      '--project',
      projectId,
      '--before',
      'Beta task',
      '--json',
    ]);
    delta = d.json<BoardTask>();
    expect(delta.position).toBe(1500);

    const e = await h.runCli([
      'task',
      'create',
      'Epsilon task',
      '--project',
      projectId,
      '--after',
      'Gamma task',
      '--json',
    ]);
    epsilon = e.json<BoardTask>();
    expect(epsilon.position).toBe(500);

    const list = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      backlogId,
      '--json',
    ]);
    expect(list.exitCode).toBe(0);
    const ids = list.json<StatefulTask[]>().map((t) => t.id);
    expect(ids).toEqual([gamma.id, epsilon.id, alpha.id, delta.id, beta.id]);
  });

  it('create resolves labels and assignees', async () => {
    const labelId = crypto.randomUUID();
    const label = await tc.request(user.token).post('/api/labels', {
      id: labelId,
      project_id: projectId,
      name: 'bug',
      color: '#ff0000',
    });
    expect(label.status).toBe(201);

    const res = await h.runCli([
      'task',
      'create',
      'Labeled task',
      '--project',
      projectId,
      '--label',
      'bug',
      '--assignee',
      user.email,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const created = res.json<BoardTask>();
    expect(created.label_ids).toEqual([labelId]);
    expect(created.assignee_ids).toEqual([user.id]);
  });

  it('list filters AND-compose', async () => {
    const client = tc.request(user.token);
    for (const [id, title, column, position] of [
      [blockerWorkId, 'Blocker work', todoId, 1000],
      [blockedWorkId, 'Blocked work', todoId, 2000],
      [finishedWorkId, 'Finished work', doneId, 1000],
    ] as const) {
      const res = await client.post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: column,
        title,
        position,
      });
      expect(res.status).toBe(201);
    }
    const block = await client.post(`/api/tasks/${blockedWorkId}/blockers`, {
      blocker_task_id: blockerWorkId,
    });
    expect(block.status).toBe(204);

    const blocked = await h.runCli(['task', 'list', '--project', projectId, '--blocked', '--json']);
    const blockedIds = blocked.json<StatefulTask[]>().map((t) => t.id);
    expect(blockedIds).toEqual([blockedWorkId]);
    expect(blocked.json<StatefulTask[]>()[0].state).toBe('blocked');

    const ready = await h.runCli(['task', 'list', '--project', projectId, '--ready', '--json']);
    const readyIds = ready.json<StatefulTask[]>().map((t) => t.id);
    expect(readyIds).toContain(blockerWorkId);
    expect(readyIds).not.toContain(blockedWorkId);
    expect(readyIds).not.toContain(finishedWorkId);

    const inColumn = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      todoId,
      '--json',
    ]);
    expect(inColumn.json<StatefulTask[]>().map((t) => t.id)).toEqual([
      blockerWorkId,
      blockedWorkId,
    ]);

    const search = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--search',
      'blocked WO',
      '--json',
    ]);
    expect(search.json<StatefulTask[]>().map((t) => t.id)).toEqual([blockedWorkId]);

    const assigned = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--assignee',
      user.email,
      '--json',
    ]);
    expect(assigned.json<StatefulTask[]>().map((t) => t.title)).toEqual(['Labeled task']);

    const done = await h.runCli(['task', 'list', '--project', projectId, '--done', '--json']);
    expect(done.json<StatefulTask[]>().map((t) => t.id)).toEqual([finishedWorkId]);

    const notDone = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--not-done',
      '--json',
    ]);
    expect(notDone.json<StatefulTask[]>().map((t) => t.id)).not.toContain(finishedWorkId);

    const composed = await h.runCli([
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      todoId,
      '--ready',
      '--json',
    ]);
    expect(composed.json<StatefulTask[]>().map((t) => t.id)).toEqual([blockerWorkId]);
  });

  it('show works by title ref and by UUID without --project', async () => {
    const byTitle = await h.runCli([
      'task',
      'show',
      'Alpha task',
      '--project',
      projectId,
      '--json',
    ]);
    expect(byTitle.exitCode).toBe(0);
    const detail = byTitle.json<TaskDetailResponse & { state: string }>();
    expect(detail.id).toBe(alpha.id);
    expect(detail.state).toBe('ready');
    expect(detail.project_id).toBe(projectId);

    const byUuid = await h.runCli(['task', 'show', alpha.id]);
    expect(byUuid.exitCode).toBe(0);
    expect(byUuid.stdout).toContain('Alpha task');
    expect(byUuid.stdout).toContain(alpha.id.slice(0, 8));
  });

  it('update changes the title and requires at least one change', async () => {
    const res = await h.runCli([
      'task',
      'update',
      'Epsilon task',
      '--project',
      projectId,
      '--title',
      'Epsilon renamed',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<BoardTask>().title).toBe('Epsilon renamed');

    const noChange = await h.runCli(['task', 'update', epsilon.id]);
    expect(noChange.exitCode).toBe(2);
  });

  it('move computes midpoint positions in the target column', async () => {
    const top = await h.runCli([
      'task',
      'move',
      'Alpha task',
      '--project',
      projectId,
      '--column',
      todoId,
      '--top',
      '--json',
    ]);
    expect(top.exitCode).toBe(0);
    const movedTop = top.json<BoardTask>();
    expect(movedTop.column_id).toBe(todoId);
    expect(movedTop.position).toBe(0);

    const between = await h.runCli([
      'task',
      'move',
      'Delta task',
      '--project',
      projectId,
      '--column',
      todoId,
      '--before',
      'Blocked work',
      '--json',
    ]);
    expect(between.exitCode).toBe(0);
    const movedBetween = between.json<BoardTask>();
    expect(movedBetween.column_id).toBe(todoId);
    expect(movedBetween.position).toBe(1500);
  });

  it('done moves the task to the bottom of the last done column', async () => {
    const res = await h.runCli(['task', 'done', 'Beta task', '--project', projectId, '--json']);
    expect(res.exitCode).toBe(0);
    const moved = res.json<BoardTask>();
    expect(moved.column_id).toBe(doneId);
    expect(moved.position).toBe(2000);
  });

  it('delete with --force removes the task', async () => {
    const res = await h.runCli([
      'task',
      'delete',
      'Delta task',
      '--project',
      projectId,
      '--force',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ deleted: boolean; id: string }>()).toEqual({
      deleted: true,
      id: delta.id,
    });

    const gone = await h.runCli(['task', 'show', delta.id]);
    expect(gone.exitCode).toBe(4);
  });

  it('label add, remove, and set follow read-modify-write semantics', async () => {
    const client = tc.request(user.token);
    const frontendId = crypto.randomUUID();
    const backendId = crypto.randomUUID();
    for (const [id, name, color] of [
      [frontendId, 'frontend', '#00ff00'],
      [backendId, 'backend', '#0000ff'],
    ] as const) {
      const res = await client.post('/api/labels', { id, project_id: projectId, name, color });
      expect(res.status).toBe(201);
    }

    const add = await h.runCli([
      'task',
      'label',
      'add',
      'Gamma task',
      'frontend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(add.exitCode).toBe(0);
    expect(add.json<{ label_ids: string[] }>().label_ids).toEqual([frontendId]);

    const addMore = await h.runCli([
      'task',
      'label',
      'add',
      'Gamma task',
      'backend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(addMore.json<{ label_ids: string[] }>().label_ids).toEqual([frontendId, backendId]);

    const remove = await h.runCli([
      'task',
      'label',
      'remove',
      'Gamma task',
      'frontend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(remove.json<{ label_ids: string[] }>().label_ids).toEqual([backendId]);

    const set = await h.runCli([
      'task',
      'label',
      'set',
      'Gamma task',
      'frontend',
      'backend',
      '--project',
      projectId,
      '--json',
    ]);
    expect(set.json<{ label_ids: string[] }>().label_ids).toEqual([frontendId, backendId]);

    const clear = await h.runCli([
      'task',
      'label',
      'set',
      'Gamma task',
      '--project',
      projectId,
      '--json',
    ]);
    expect(clear.exitCode).toBe(0);
    expect(clear.json<{ label_ids: string[] }>().label_ids).toEqual([]);

    const detail = await client.get(`/api/tasks/${gamma.id}`);
    expect(((await detail.json()) as TaskDetailResponse).label_ids).toEqual([]);
  });

  it('assign and unassign resolve users by email', async () => {
    const assign = await h.runCli([
      'task',
      'assign',
      'Gamma task',
      user.email,
      '--project',
      projectId,
      '--json',
    ]);
    expect(assign.exitCode).toBe(0);
    expect(assign.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([user.id]);

    const unassign = await h.runCli([
      'task',
      'unassign',
      'Gamma task',
      user.email,
      '--project',
      projectId,
      '--json',
    ]);
    expect(unassign.exitCode).toBe(0);
    expect(unassign.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([]);

    const set = await h.runCli([
      'task',
      'assignees',
      'set',
      'Gamma task',
      user.email,
      '--project',
      projectId,
      '--json',
    ]);
    expect(set.exitCode).toBe(0);
    expect(set.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([user.id]);

    const clear = await h.runCli([
      'task',
      'assignees',
      'set',
      'Gamma task',
      '--project',
      projectId,
      '--json',
    ]);
    expect(clear.exitCode).toBe(0);
    expect(clear.json<{ assignee_ids: string[] }>().assignee_ids).toEqual([]);
  });

  it('ambiguous title refs exit 2', async () => {
    for (const title of ['Zeta duplicate one', 'Zeta duplicate two']) {
      const res = await h.runCli(['task', 'create', title, '--project', projectId]);
      expect(res.exitCode).toBe(0);
    }
    const res = await h.runCli(['task', 'show', 'zeta duplicate', '--project', projectId]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Ambiguous');
  });

  it('conflicting placement flags exit 2', async () => {
    const res = await h.runCli([
      'task',
      'create',
      'Conflicting placement',
      '--project',
      projectId,
      '--top',
      '--bottom',
    ]);
    expect(res.exitCode).toBe(2);
  });
});
