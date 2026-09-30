import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../api/tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardResponse'];
type SearchResponse = components['schemas']['SearchResponse'];

describe('task search', () => {
  const tc = new TestContext();
  let owner: TestUser;
  let h: CliHarness;
  let alpha: { id: string; columnName: string };
  let alphaTaskId: string;
  let betaTaskId: string;

  async function createProject(
    name: string
  ): Promise<{ id: string; columnId: string; columnName: string }> {
    const id = crypto.randomUUID();
    const res = await tc.request(owner.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    const board = (await res.json()) as BoardPayload;
    const column = [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1))[0];
    return { id, columnId: column.id, columnName: column.name };
  }

  async function createTask(projectId: string, columnId: string, title: string, position: number) {
    const id = crypto.randomUUID();
    const res = await tc
      .request(owner.token)
      .post('/api/tasks', { id, project_id: projectId, column_id: columnId, title, position });
    expect(res.status).toBe(201);
    return id;
  }

  beforeAll(async () => {
    owner = await tc.createUser('cli-tasksearch');
    h = await createCliHarness();
    await h.runCli(['login', '--email', owner.email, '--password-stdin'], {
      stdin: `${owner.password}\n`,
    });

    const alphaProject = await createProject('CLI Search Alpha');
    const betaProject = await createProject('CLI Search Beta');
    alpha = { id: alphaProject.id, columnName: alphaProject.columnName };
    alphaTaskId = await createTask(alphaProject.id, alphaProject.columnId, 'Zircon rollout', 1000);
    betaTaskId = await createTask(betaProject.id, betaProject.columnId, 'Zircon audit', 1000);
  });

  afterAll(async () => {
    await tc.cleanup();
  });

  it('searches every project, not the configured default-project', async () => {
    const set = await h.runCli(['config', 'set', 'default-project', alpha.id]);
    expect(set.exitCode).toBe(0);

    const res = await h.runCli(['task', 'search', 'zircon', '--json']);
    expect(res.exitCode).toBe(0);
    const body = res.json<SearchResponse>();
    expect(body.results.map((r) => r.task_id).sort()).toEqual([alphaTaskId, betaTaskId].sort());
    expect(body.truncated).toBe(false);
  });

  it('narrows to one project with --project', async () => {
    const res = await h.runCli([
      'task',
      'search',
      'zircon',
      '--project',
      'CLI Search Alpha',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<SearchResponse>().results.map((r) => r.task_id)).toEqual([alphaTaskId]);
  });

  it('prints each match with its project and column', async () => {
    const res = await h.runCli(['task', 'search', 'zircon rollout']);
    expect(res.exitCode).toBe(0);
    const row = res.stdout.split('\n').find((line) => line.includes('Zircon rollout'));
    expect(row).toContain(alphaTaskId.slice(0, 8));
    expect(row).toContain('CLI Search Alpha');
    expect(row).toContain(alpha.columnName);
  });

  it('says so when nothing matches', async () => {
    const res = await h.runCli(['task', 'search', 'quartzite']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('No matching tasks');
  });

  it('notes when more matched than the server returned', async () => {
    const many = await createProject('CLI Search Many');
    for (let i = 0; i < 51; i++) {
      await createTask(many.id, many.columnId, `Basalt note ${i}`, 1000 * (i + 1));
    }

    const json = await h.runCli(['task', 'search', 'basalt', '--json']);
    expect(json.exitCode).toBe(0);
    expect(json.json<SearchResponse>().truncated).toBe(true);

    const text = await h.runCli(['task', 'search', 'basalt']);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain('More matched than are shown');
  });

  it('exits 4 for a --project that does not resolve', async () => {
    const res = await h.runCli(['task', 'search', 'zircon', '--project', 'no-such-project-here']);
    expect(res.exitCode).toBe(4);
  });
});
