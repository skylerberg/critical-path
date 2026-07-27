import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type MyTasksResponse = components['schemas']['MyTasksResponse'];

describe('mine', () => {
  const tc = new TestContext();
  let owner: TestUser;
  let mate: TestUser;
  let stranger: TestUser;
  let h: CliHarness;
  let strangerHarness: CliHarness;
  let projectId: string;
  let blockingId: string;
  let readyId: string;
  let blockedId: string;

  beforeAll(async () => {
    owner = await tc.createUser('cli-mine');
    mate = await tc.createUser('cli-mine-mate');
    stranger = await tc.createUser('cli-mine-stranger');
    h = await createCliHarness();
    await h.runCli(['login', '--email', owner.email, '--password-stdin'], {
      stdin: `${owner.password}\n`,
    });
    strangerHarness = await createCliHarness();
    await strangerHarness.runCli(['login', '--email', stranger.email, '--password-stdin'], {
      stdin: `${stranger.password}\n`,
    });

    const client = tc.request(owner.token);
    projectId = crypto.randomUUID();
    const create = await client.post('/api/projects', { id: projectId, name: 'CLI Mine Fixture' });
    expect(create.status).toBe(201);
    const board = (await create.json()) as BoardPayload;
    const todo = [...board.columns].sort((a, b) => a.position - b.position)[1].id;

    const members = await client.put(`/api/projects/${projectId}/members`, {
      user_ids: [mate.id],
    });
    expect(members.status).toBe(204);

    blockingId = crypto.randomUUID();
    readyId = crypto.randomUUID();
    blockedId = crypto.randomUUID();
    const waiterId = crypto.randomUUID();
    const blockerId = crypto.randomUUID();
    for (const [id, title, position] of [
      [blockingId, 'Ship the export API', 1000],
      [readyId, 'Write the docs', 2000],
      [blockedId, 'Build the feature', 3000],
      [waiterId, 'Wire up the importer', 4000],
      [blockerId, 'Decide on the file format', 5000],
    ] as const) {
      const res = await client.post('/api/tasks', {
        id,
        project_id: projectId,
        column_id: todo,
        title,
        position,
      });
      expect(res.status).toBe(201);
    }

    for (const [taskId, userIds] of [
      [blockingId, [owner.id]],
      [readyId, [owner.id]],
      [blockedId, [owner.id]],
      [waiterId, [mate.id]],
    ] as const) {
      const res = await client.put(`/api/tasks/${taskId}/assignees`, { user_ids: userIds });
      expect(res.status).toBe(204);
    }

    for (const [blocked, blocker] of [
      [waiterId, blockingId],
      [blockedId, blockerId],
    ] as const) {
      const res = await client.post(`/api/tasks/${blocked}/blockers`, {
        blocker_task_id: blocker,
      });
      expect(res.status).toBe(204);
    }
  });

  afterAll(async () => {
    await tc.request(owner.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('--json returns the buckets in order with both person groups', async () => {
    const res = await h.runCli(['mine', '--json']);
    expect(res.exitCode).toBe(0);
    const payload = res.json<MyTasksResponse>();
    expect(payload.tasks.map((task) => [task.id, task.bucket])).toEqual([
      [blockingId, 'blocking'],
      [readyId, 'ready'],
      [blockedId, 'blocked'],
    ]);
    expect(payload.waiting_on_you.map((group) => group.user_id)).toEqual([mate.id]);
    expect(payload.you_are_waiting_on.map((group) => group.user_id)).toEqual([null]);
  });

  it('--json makes a single API request', async () => {
    const paths: string[] = [];
    const res = await h.runCli(['mine', '--json'], {
      onRequest: (request) => paths.push(new URL(request.url).pathname),
    });
    expect(res.exitCode).toBe(0);
    expect(paths).toEqual(['/api/my-tasks']);
  });

  it('renders every section, the waiting count column, and the people involved', async () => {
    const res = await h.runCli(['mine']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Blocking others');
    expect(res.stdout).toContain('Ready');
    expect(res.stdout).toContain('Blocked');
    expect(res.stdout).toContain('Waiting on you');
    expect(res.stdout).toContain('You are waiting on');

    const lines = res.stdout.split('\n');
    expect(lines.find((line) => line.includes('ID'))).toContain('WAITING');
    const blockingLine = lines.find((line) => line.includes('Ship the export API'))!;
    expect(blockingLine).toContain(blockingId.slice(0, 8));
    expect(blockingLine).toContain('CLI Mine Fixture');
    expect(blockingLine.trimEnd().endsWith('1')).toBe(true);

    expect(res.stdout).toContain(`${mate.name} <${mate.email}>`);
    expect(res.stdout).toContain('1 task');
    expect(res.stdout).toContain('Unassigned');
    expect(res.stdout).toContain('Decide on the file format');
  });

  it('says so when nothing is assigned', async () => {
    const res = await strangerHarness.runCli(['mine']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe('No tasks assigned to you');
  });

  it('exits with the auth code when logged out', async () => {
    const anonymous = await createCliHarness();
    const res = await anonymous.runCli(['mine']);
    expect(res.exitCode).toBe(3);
  });
});
