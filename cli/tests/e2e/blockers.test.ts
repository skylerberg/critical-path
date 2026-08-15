import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import { encodeId } from '../../src/short-links';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardResponse'];
type BoardTask = components['schemas']['BoardTask'];
type StatefulTask = BoardTask & { state: string };

interface BlockersJson {
  blocked_by: StatefulTask[];
  blocks: StatefulTask[];
}

interface TreeNode {
  task: BoardTask;
  state: string;
  blockers?: TreeNode[];
  dependents?: TreeNode[];
}

interface BlockersTreeJson {
  blocked_by_tree: TreeNode | null;
  blocks_tree: TreeNode | null;
}

interface TaskShowJson {
  blocker_ids: string[];
  blocked_task_ids: string[];
}

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
    const column = [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1))[0];
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

  it('a dependency cycle exits 5 and names the loop', async () => {
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
    expect(res.stderr).toContain(
      'Adding this blocker would create a dependency cycle: Plan the API -> Build the API -> Plan the API'
    );
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
    const { blocked_by: blockedBy, blocks } = res.json<BlockersJson>();
    expect(blockedBy.map((t) => t.id)).toEqual([planId]);
    expect(blockedBy[0].state).toBe('blocked');
    expect(blocks).toEqual([]);
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
    expect(res.stdout).toContain('Blocked by:');
    expect(res.stdout).not.toContain('Blocks:');
  });

  it('blockers shows both directions for a task in the middle of a chain', async () => {
    const json = await h.runCli([
      'task',
      'blockers',
      'Plan the API',
      '--project',
      projectId,
      '--json',
    ]);
    expect(json.exitCode).toBe(0);
    const { blocked_by: blockedBy, blocks } = json.json<BlockersJson>();
    expect(blockedBy.map((t) => t.id)).toEqual([draftId]);
    expect(blockedBy[0].state).toBe('ready');
    expect(blocks.map((t) => t.id)).toEqual([buildId]);
    expect(blocks[0].state).toBe('blocked');

    const human = await h.runCli(['task', 'blockers', 'Plan the API', '--project', projectId]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Blocked by:');
    expect(human.stdout).toContain('Blocks:');
    expect(human.stdout.indexOf('Blocked by:')).toBeLessThan(human.stdout.indexOf('Blocks:'));
    const buildLine = human.stdout.split('\n').find((l) => l.includes(buildId.slice(0, 8)));
    expect(buildLine).toContain('[blocked]');
  });

  it('does not say nothing blocks a task that blocks others', async () => {
    const human = await h.runCli([
      'task',
      'blockers',
      'Draft requirements',
      '--project',
      projectId,
    ]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).not.toContain('Nothing blocks this task');
    expect(human.stdout).not.toContain('Blocked by:');
    expect(human.stdout).toContain('Blocks:');
    expect(human.stdout).toContain(planId.slice(0, 8));

    const json = await h.runCli([
      'task',
      'blockers',
      'Draft requirements',
      '--project',
      projectId,
      '--json',
    ]);
    const { blocked_by: blockedBy, blocks } = json.json<BlockersJson>();
    expect(blockedBy).toEqual([]);
    expect(blocks.map((t) => t.id)).toEqual([planId]);
  });

  it('blockers --tree walks both directions', async () => {
    const human = await h.runCli([
      'task',
      'blockers',
      'Plan the API',
      '--project',
      projectId,
      '--tree',
    ]);
    expect(human.exitCode).toBe(0);
    const lines = human.stdout.split('\n');
    expect(lines[0]).toMatch(new RegExp(`^${planId.slice(0, 8)}`));
    expect(lines[1]).toBe('Blocked by:');
    expect(lines[2]).toMatch(new RegExp(`^  ${draftId.slice(0, 8)}`));
    expect(lines[3]).toBe('Blocks:');
    expect(lines[4]).toMatch(new RegExp(`^  ${buildId.slice(0, 8)}`));

    const json = await h.runCli([
      'task',
      'blockers',
      'Plan the API',
      '--project',
      projectId,
      '--tree',
      '--json',
    ]);
    const { blocked_by_tree: blockedByTree, blocks_tree: blocksTree } =
      json.json<BlockersTreeJson>();
    expect(blockedByTree?.task.id).toBe(planId);
    expect(blockedByTree?.blockers?.map((n) => n.task.id)).toEqual([draftId]);
    expect(blocksTree?.task.id).toBe(planId);
    expect(blocksTree?.dependents?.map((n) => n.task.id)).toEqual([buildId]);
  });

  it('blockers --tree omits the blocked-by heading for a task that only blocks', async () => {
    const human = await h.runCli([
      'task',
      'blockers',
      'Draft requirements',
      '--project',
      projectId,
      '--tree',
    ]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).not.toContain('Blocked by:');
    const lines = human.stdout.split('\n');
    expect(lines[0]).toMatch(new RegExp(`^${draftId.slice(0, 8)}`));
    expect(lines[1]).toBe('Blocks:');
    expect(lines[2]).toMatch(new RegExp(`^  ${planId.slice(0, 8)}`));
    expect(lines[3]).toMatch(new RegExp(`^    ${buildId.slice(0, 8)}`));

    const json = await h.runCli([
      'task',
      'blockers',
      'Draft requirements',
      '--project',
      projectId,
      '--tree',
      '--json',
    ]);
    const { blocked_by_tree: blockedByTree, blocks_tree: blocksTree } =
      json.json<BlockersTreeJson>();
    expect(blockedByTree?.task.id).toBe(draftId);
    expect(blockedByTree?.blockers).toEqual([]);
    expect(blocksTree?.dependents?.map((n) => n.task.id)).toEqual([planId]);
  });

  it('show renders both dependency directions', async () => {
    const human = await h.runCli(['task', 'show', 'Plan the API', '--project', projectId]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Blocked by:');
    expect(human.stdout).toContain('Blocks:');
    expect(human.stdout.indexOf('Blocked by:')).toBeLessThan(human.stdout.indexOf('Blocks:'));
    expect(human.stdout.indexOf(draftId.slice(0, 8))).toBeLessThan(
      human.stdout.indexOf(buildId.slice(0, 8))
    );

    const json = await h.runCli(['task', 'show', 'Plan the API', '--project', projectId, '--json']);
    const plan = json.json<TaskShowJson>();
    expect(plan.blocker_ids).toEqual([draftId]);
    expect(plan.blocked_task_ids).toEqual([buildId]);

    const leaf = await h.runCli([
      'task',
      'show',
      'Build the API',
      '--project',
      projectId,
      '--json',
    ]);
    const build = leaf.json<TaskShowJson>();
    expect(build.blocker_ids).toEqual([planId]);
    expect(build.blocked_task_ids).toEqual([]);
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
    expect(empty.json<BlockersJson>()).toEqual({
      blocked_by: [],
      blocks: [],
      cross_project: {
        blocked_by: [],
        blocking: [],
        hidden_blocked_by_count: 0,
        hidden_blocking_count: 0,
      },
    });

    const human = await h.runCli(['task', 'blockers', 'Build the API', '--project', projectId]);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Nothing blocks this task');
  });

  it('block and unblock take an alias for --by', async () => {
    const alias = encodeId(planId);
    const block = await h.runCli([
      'task',
      'block',
      'Build the API',
      '--by',
      alias,
      '--project',
      projectId,
    ]);
    expect(block.exitCode).toBe(0);
    expect(block.stdout).toContain('now blocks');

    const blocked = await h.runCli([
      'task',
      'blockers',
      'Build the API',
      '--project',
      projectId,
      '--json',
    ]);
    expect(blocked.json<BlockersJson>().blocked_by.map((t) => t.id)).toEqual([planId]);

    const unblock = await h.runCli([
      'task',
      'unblock',
      'Build the API',
      '--by',
      alias,
      '--project',
      projectId,
    ]);
    expect(unblock.exitCode).toBe(0);

    const after = await h.runCli([
      'task',
      'blockers',
      'Build the API',
      '--project',
      projectId,
      '--json',
    ]);
    expect(after.json<BlockersJson>().blocked_by).toEqual([]);
  });

  describe('across projects', () => {
    let farProjectId: string;
    let farTaskId: string;
    let farColumnId: string;
    let farDoneColumnId: string;

    beforeAll(async () => {
      const client = tc.request(user.token);
      const create = await client.post('/api/projects', {
        id: crypto.randomUUID(),
        name: 'CLI Blockers Far Board',
      });
      expect(create.status).toBe(201);
      const board = (await create.json()) as BoardPayload;
      farProjectId = board.project.id;
      const column = [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1))[0];
      farColumnId = column.id;
      farDoneColumnId = board.columns.find((c) => c.is_done)!.id;
      farTaskId = crypto.randomUUID();
      expect(
        (
          await client.post('/api/tasks', {
            id: farTaskId,
            project_id: farProjectId,
            column_id: column.id,
            title: 'Sign the contract',
            position: 1000,
          })
        ).status
      ).toBe(201);
    });

    afterAll(async () => {
      await tc.request(user.token).delete(`/api/projects/${farProjectId}`);
    });

    it('blocks by a task on another board, named by title with --by-project', async () => {
      const res = await h.runCli([
        'task',
        'block',
        'Draft requirements',
        '--by',
        'Sign the contract',
        '--by-project',
        farProjectId,
        '--project',
        projectId,
      ]);
      expect(res.exitCode).toBe(0);

      const blockers = await h.runCli([
        'task',
        'blockers',
        'Draft requirements',
        '--project',
        projectId,
        '--json',
      ]);
      const json = blockers.json<
        BlockersJson & { cross_project: { blocked_by: { task_id: string; title: string }[] } }
      >();
      // Not in blocker_ids: that list resolves against this board only.
      expect(json.blocked_by).toEqual([]);
      expect(json.cross_project.blocked_by.map((edge) => edge.task_id)).toEqual([farTaskId]);
    });

    it('names the far blocker, its board and its state in the default output', async () => {
      const near = await h.runCli([
        'task',
        'blockers',
        'Draft requirements',
        '--project',
        projectId,
      ]);
      expect(near.exitCode).toBe(0);
      expect(near.stdout).toContain('Blocked by (other projects):');
      expect(near.stdout.split('\n').find((l) => l.includes(farTaskId.slice(0, 8)))).toBe(
        `  ${farTaskId.slice(0, 8)}  [open]     Sign the contract  (CLI Blockers Far Board)`
      );

      const far = await h.runCli([
        'task',
        'blockers',
        'Sign the contract',
        '--project',
        farProjectId,
      ]);
      expect(far.exitCode).toBe(0);
      expect(far.stdout).toContain('Blocks (other projects):');
      expect(far.stdout).not.toContain('Nothing blocks this task');
      expect(far.stdout.split('\n').find((l) => l.includes(draftId.slice(0, 8)))).toBe(
        `  ${draftId.slice(0, 8)}  [open]     Draft requirements  (CLI Blockers Fixture)`
      );
    });

    it('marks a far blocker done once it reaches a done column', async () => {
      const client = tc.request(user.token);
      const moved = await client.patch(`/api/tasks/${farTaskId}`, { column_id: farDoneColumnId });
      expect(moved.status).toBe(200);
      try {
        const res = await h.runCli([
          'task',
          'blockers',
          'Draft requirements',
          '--project',
          projectId,
        ]);
        expect(res.exitCode).toBe(0);
        expect(res.stdout.split('\n').find((l) => l.includes(farTaskId.slice(0, 8)))).toBe(
          `  ${farTaskId.slice(0, 8)}  [done]     Sign the contract  (CLI Blockers Far Board)`
        );
      } finally {
        expect(
          (await client.patch(`/api/tasks/${farTaskId}`, { column_id: farColumnId })).status
        ).toBe(200);
      }
    });

    it('drops the blocked task out of ready while the far blocker is open', async () => {
      const ready = await h.runCli(['ready', '--project', projectId, '--json']);
      expect(ready.exitCode).toBe(0);
      const ids = ready.json<{ id: string }[]>().map((task) => task.id);
      expect(ids).not.toContain(draftId);
    });

    it('unblocks by a bare uuid without resolving the far task', async () => {
      const res = await h.runCli([
        'task',
        'unblock',
        'Draft requirements',
        '--by',
        farTaskId,
        '--project',
        projectId,
      ]);
      expect(res.exitCode).toBe(0);

      const ready = await h.runCli(['ready', '--project', projectId, '--json']);
      expect(ready.json<{ id: string }[]>().map((task) => task.id)).toContain(draftId);
    });

    it('counts a blocker on an unreadable board without naming it', async () => {
      const stranger = await tc.createUser('cli-blockers-stranger');
      const strangerClient = tc.request(stranger.token);
      const secretProjectId = crypto.randomUUID();
      const created = await strangerClient.post('/api/projects', {
        id: secretProjectId,
        name: 'Stranger Private Board',
      });
      expect(created.status).toBe(201);
      const secret = (await created.json()) as BoardPayload;
      const secretColumn = [...secret.columns].sort((a, b) =>
        a.sort_key < b.sort_key ? -1 : 1
      )[0];
      const secretTaskId = crypto.randomUUID();
      expect(
        (
          await strangerClient.post('/api/tasks', {
            id: secretTaskId,
            project_id: secretProjectId,
            column_id: secretColumn.id,
            title: 'Sign the NDA',
          })
        ).status
      ).toBe(201);

      const joined = await tc
        .request(user.token)
        .put(`/api/projects/${projectId}/members`, { user_ids: [stranger.id] });
      expect(joined.status).toBe(204);
      const edge = await strangerClient.post(`/api/tasks/${draftId}/blockers`, {
        blocker_task_id: secretTaskId,
      });
      expect(edge.status).toBe(204);

      const res = await h.runCli([
        'task',
        'blockers',
        'Draft requirements',
        '--project',
        projectId,
      ]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain('Blocked by (other projects):');
      expect(res.stdout).toContain('  1 task in another project you cannot see');
      expect(res.stdout).not.toContain('Sign the NDA');
      expect(res.stdout).not.toContain(secretTaskId.slice(0, 8));

      const json = await h.runCli([
        'task',
        'blockers',
        'Draft requirements',
        '--project',
        projectId,
        '--json',
      ]);
      const { cross_project: crossProject } = json.json<{
        cross_project: {
          blocked_by: unknown[];
          hidden_blocked_by_count: number;
        };
      }>();
      expect(crossProject.blocked_by).toEqual([]);
      expect(crossProject.hidden_blocked_by_count).toBe(1);
    });
  });
});
