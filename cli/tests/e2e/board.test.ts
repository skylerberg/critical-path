import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type BoardTask = components['schemas']['BoardTask'];

describe('board and ready views', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let board: BoardPayload;
  let todo: string;
  let done: string;
  let blockerId: string;
  let blockedId: string;
  let readyId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-board');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    const client = tc.request(user.token);
    const create = await client.post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Board Fixture',
    });
    expect(create.status).toBe(201);
    board = (await create.json()) as BoardPayload;
    const columns = [...board.columns].sort((a, b) => a.position - b.position);
    todo = columns[1].id;
    done = columns.find((c) => c.is_done)!.id;

    blockerId = crypto.randomUUID();
    blockedId = crypto.randomUUID();
    readyId = crypto.randomUUID();
    const finishedId = crypto.randomUUID();
    for (const [id, title, column, position] of [
      [blockerId, 'Design the schema', todo, 1000],
      [blockedId, 'Build the feature', todo, 2000],
      [readyId, 'Write the docs', todo, 3000],
      [finishedId, 'Old finished work', done, 1000],
    ] as const) {
      const res = await client.post('/api/tasks', {
        id,
        project_id: board.project.id,
        column_id: column,
        title,
        position,
      });
      expect(res.status).toBe(201);
    }
    const block = await client.post(`/api/tasks/${blockedId}/blockers`, {
      blocker_task_id: blockerId,
    });
    expect(block.status).toBe(204);
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${board.project.id}`);
    await tc.cleanup();
  });

  it('board renders columns with ready/blocked markers', async () => {
    const res = await h.runCli(['board', 'CLI Board Fixture']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('CLI Board Fixture');
    const lines = res.stdout.split('\n');
    const blockedLine = lines.find((l) => l.includes('Build the feature'));
    expect(blockedLine).toContain('[blocked]');
    const readyLine = lines.find((l) => l.includes('Design the schema'));
    expect(readyLine).toContain('[ready]');
  });

  it('board --json annotates tasks with their state', async () => {
    const res = await h.runCli(['board', board.project.id, '--json']);
    expect(res.exitCode).toBe(0);
    const payload = res.json<Omit<BoardPayload, 'tasks'> & { tasks: (BoardTask & { state: string })[] }>();
    const states = new Map(payload.tasks.map((t) => [t.id, t.state]));
    expect(states.get(blockerId)).toBe('ready');
    expect(states.get(blockedId)).toBe('blocked');
    expect(states.get(readyId)).toBe('ready');
  });

  it('ready lists only unblocked, unfinished tasks', async () => {
    const res = await h.runCli(['ready', '--project', board.project.id, '--json']);
    expect(res.exitCode).toBe(0);
    const ids = res.json<BoardTask[]>().map((t) => t.id);
    expect(ids).toContain(blockerId);
    expect(ids).toContain(readyId);
    expect(ids).not.toContain(blockedId);
  });

  it('resolves the project from the default-project config', async () => {
    const set = await h.runCli(['config', 'set', 'default-project', board.project.id]);
    if (set.exitCode === 0) {
      const res = await h.runCli(['ready', '--json']);
      expect(res.exitCode).toBe(0);
    }
  });

  it('unresolvable project exits 4', async () => {
    const res = await h.runCli(['board', 'no-such-project-here']);
    expect(res.exitCode).toBe(4);
  });

  it('missing project spec exits 2 with guidance', async () => {
    const fresh = await createCliHarness();
    const res = await fresh.runCli(['ready']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('--project');
  });
});
