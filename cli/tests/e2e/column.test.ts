import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type Column = components['schemas']['Column'];
type ListedColumn = components['schemas']['BoardColumn'] & { task_count: number };

describe('column commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;

  async function listColumns(): Promise<ListedColumn[]> {
    const res = await h.runCli(['column', 'list', '--project', projectId, '--json']);
    expect(res.exitCode).toBe(0);
    return res.json<ListedColumn[]>();
  }

  beforeAll(async () => {
    user = await tc.createUser('cli-column');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await h.runCli(['project', 'create', 'CLI Columns', '--json']);
    expect(create.exitCode).toBe(0);
    projectId = create.json<BoardPayload>().project.id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('list shows the default columns in position order', async () => {
    const columns = await listColumns();
    expect(columns.map((c) => c.name)).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
    expect(columns.find((c) => c.name === 'Done')?.is_done).toBe(true);
  });

  it('create respects placement flags and defaults to the bottom', async () => {
    const after = await h.runCli([
      'column',
      'create',
      'Review',
      '--project',
      projectId,
      '--after',
      'In Progress',
      '--json',
    ]);
    expect(after.exitCode).toBe(0);

    const top = await h.runCli([
      'column',
      'create',
      'Icebox',
      '--project',
      projectId,
      '--top',
      '--json',
    ]);
    expect(top.exitCode).toBe(0);

    const bottom = await h.runCli([
      'column',
      'create',
      'Someday',
      '--project',
      projectId,
      '--done',
      '--json',
    ]);
    expect(bottom.exitCode).toBe(0);
    expect(bottom.json<Column>().is_done).toBe(true);

    const columns = await listColumns();
    expect(columns.map((c) => c.name)).toEqual([
      'Icebox',
      'Backlog',
      'To Do',
      'In Progress',
      'Review',
      'Done',
      'Someday',
    ]);
  });

  it('create rejects conflicting placement flags', async () => {
    const res = await h.runCli([
      'column',
      'create',
      'Nope',
      '--project',
      projectId,
      '--top',
      '--bottom',
    ]);
    expect(res.exitCode).toBe(2);
  });

  it('move repositions a column and requires a placement flag', async () => {
    const move = await h.runCli([
      'column',
      'move',
      'Someday',
      '--project',
      projectId,
      '--before',
      'Backlog',
    ]);
    expect(move.exitCode).toBe(0);
    const columns = await listColumns();
    expect(columns.map((c) => c.name).slice(0, 3)).toEqual(['Icebox', 'Someday', 'Backlog']);

    const noFlag = await h.runCli(['column', 'move', 'Someday', '--project', projectId]);
    expect(noFlag.exitCode).toBe(2);
  });

  it('update renames and toggles done', async () => {
    const res = await h.runCli([
      'column',
      'update',
      'Review',
      '--project',
      projectId,
      '--name',
      'Code Review',
      '--done',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const updated = res.json<Column>();
    expect(updated.name).toBe('Code Review');
    expect(updated.is_done).toBe(true);

    const undone = await h.runCli([
      'column',
      'update',
      'Code Review',
      '--project',
      projectId,
      '--no-done',
      '--json',
    ]);
    expect(undone.json<Column>().is_done).toBe(false);

    const none = await h.runCli(['column', 'update', 'Code Review', '--project', projectId]);
    expect(none.exitCode).toBe(2);
  });

  it('delete with tasks conflicts, then succeeds with --move-tasks-to', async () => {
    const columns = await listColumns();
    const todo = columns.find((c) => c.name === 'To Do')!;
    const backlog = columns.find((c) => c.name === 'Backlog')!;
    const taskId = crypto.randomUUID();
    const taskRes = await tc.request(user.token).post('/api/tasks', {
      id: taskId,
      project_id: projectId,
      column_id: todo.id,
      title: 'Stranded task',
      position: 1000,
    });
    expect(taskRes.status).toBe(201);

    const conflict = await h.runCli([
      'column',
      'delete',
      'To Do',
      '--project',
      projectId,
      '--force',
    ]);
    expect(conflict.exitCode).toBe(5);
    expect(conflict.stderr).toContain('--move-tasks-to');

    const del = await h.runCli([
      'column',
      'delete',
      'To Do',
      '--project',
      projectId,
      '--move-tasks-to',
      'Backlog',
      '--force',
      '--json',
    ]);
    expect(del.exitCode).toBe(0);
    const moved = del.json<{ moved_tasks: { id: string; column_id: string }[] }>().moved_tasks;
    expect(moved.map((t) => t.id)).toContain(taskId);

    const board = await h.runCli(['board', projectId, '--json']);
    const task = board.json<BoardPayload>().tasks.find((t) => t.id === taskId);
    expect(task?.column_id).toBe(backlog.id);
    expect((await listColumns()).map((c) => c.name)).not.toContain('To Do');
  });

  it('delete of an empty column reports no moved tasks', async () => {
    const res = await h.runCli([
      'column',
      'delete',
      'Icebox',
      '--project',
      projectId,
      '--force',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ moved_tasks: unknown[] }>().moved_tasks).toEqual([]);
    expect((await listColumns()).map((c) => c.name)).not.toContain('Icebox');
  });

  it('unresolvable column ref exits 4', async () => {
    const res = await h.runCli(['column', 'update', 'zz-nope', '--project', projectId, '--done']);
    expect(res.exitCode).toBe(4);
  });
});
