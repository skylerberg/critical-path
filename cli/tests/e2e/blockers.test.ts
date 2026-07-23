import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type BoardTask = components['schemas']['BoardTask'];
type StatefulTask = BoardTask & { state: string };

describe('task blockers', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  const planId = crypto.randomUUID();
  const buildId = crypto.randomUUID();
  const draftId = crypto.randomUUID();

  beforeAll(async () => {
    user = await tc.createUser('cli-blockers');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const client = tc.request(user.token);
    const create = await client.post('/api/projects', {
      id: crypto.randomUUID(),
      name: 'CLI Blockers Fixture',
    });
    expect(create.status).toBe(201);
    const board = (await create.json()) as BoardPayload;
    projectId = board.project.id;
    const column = [...board.columns].sort((a, b) => a.position - b.position)[0];
    for (const [id, title, position] of [
      [planId, 'Plan the API', 1000],
      [buildId, 'Build the API', 2000],
      [draftId, 'Draft requirements', 3000],
    ] as const) {
      const res = await client.post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: column.id,
        title,
        position,
      });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('block records a blocker and the task shows blocked in list --json', async () => {
    const res = await h.runCli([
      'task',
      'block',
      'Build the API',
      '--by',
      'Plan the API',
      '--project',
      projectId,
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('now blocks');

    const list = await h.runCli(['task', 'list', '--project', projectId, '--json']);
    const states = new Map(list.json<StatefulTask[]>().map((t) => [t.id, t.state]));
    expect(states.get(buildId)).toBe('blocked');
    expect(states.get(planId)).toBe('ready');
  });

  it('a dependency cycle exits 5', async () => {
    const res = await h.runCli([
      'task',
      'block',
      'Plan the API',
      '--by',
      'Build the API',
      '--project',
      projectId,
    ]);
    expect(res.exitCode).toBe(5);
  });

  it('blockers lists direct blockers with their state', async () => {
    const chain = await h.runCli([
      'task',
      'block',
      'Plan the API',
      '--by',
      'Draft requirements',
      '--project',
      projectId,
    ]);
    expect(chain.exitCode).toBe(0);

    const res = await h.runCli([
      'task',
      'blockers',
      'Build the API',
      '--project',
      projectId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const blockers = res.json<StatefulTask[]>();
    expect(blockers.map((t) => t.id)).toEqual([planId]);
    expect(blockers[0].state).toBe('blocked');
  });

  it('blockers --tree renders the transitive chain with indentation', async () => {
    const res = await h.runCli([
      'task',
      'blockers',
      'Build the API',
      '--project',
      projectId,
      '--tree',
    ]);
    expect(res.exitCode).toBe(0);
    const lines = res.stdout.split('\n');
    const rootLine = lines.find((l) => l.includes('Build the API'));
    const midLine = lines.find((l) => l.includes('Plan the API'));
    const leafLine = lines.find((l) => l.includes('Draft requirements'));
    expect(rootLine).toMatch(new RegExp(`^${buildId.slice(0, 8)}`));
    expect(rootLine).toContain('[blocked]');
    expect(midLine).toMatch(new RegExp(`^  ${planId.slice(0, 8)}`));
    expect(midLine).toContain('[blocked]');
    expect(leafLine).toMatch(new RegExp(`^    ${draftId.slice(0, 8)}`));
    expect(leafLine).toContain('[ready]');
  });

  it('unblock removes the dependency and is idempotent', async () => {
    const res = await h.runCli([
      'task',
      'unblock',
      'Build the API',
      '--by',
      'Plan the API',
      '--project',
      projectId,
    ]);
    expect(res.exitCode).toBe(0);

    const list = await h.runCli(['task', 'list', '--project', projectId, '--json']);
    const states = new Map(list.json<StatefulTask[]>().map((t) => [t.id, t.state]));
    expect(states.get(buildId)).toBe('ready');

    const again = await h.runCli([
      'task',
      'unblock',
      'Build the API',
      '--by',
      'Plan the API',
      '--project',
      projectId,
    ]);
    expect(again.exitCode).toBe(0);

    const empty = await h.runCli([
      'task',
      'blockers',
      'Build the API',
      '--project',
      projectId,
      '--json',
    ]);
    expect(empty.json<StatefulTask[]>()).toEqual([]);
  });
});
