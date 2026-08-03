import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardResponse = components['schemas']['BoardResponse'];
type BoardTask = components['schemas']['BoardTask'];
type ChecklistItem = components['schemas']['ChecklistItem'];

describe('task checklist commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;

  async function createCard(title: string): Promise<string> {
    const res = await h.runCli(['task', 'create', title, '--project', projectId, '--json']);
    expect(res.exitCode).toBe(0);
    return res.json<BoardTask>().id;
  }

  async function items(taskRef: string): Promise<ChecklistItem[]> {
    const res = await h.runCli([
      'task',
      'checklist',
      'list',
      taskRef,
      '--project',
      projectId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    return res.json<ChecklistItem[]>();
  }

  beforeAll(async () => {
    user = await tc.createUser('cli-checklist');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await h.runCli(['project', 'create', 'CLI Checklists', '--json']);
    expect(create.exitCode).toBe(0);
    projectId = create.json<BoardResponse>().project.id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('adds items at the bottom and lists them with a progress line', async () => {
    const taskId = await createCard('Add flow');
    for (const text of ['write the test', 'fix the bug']) {
      const res = await h.runCli([
        'task',
        'checklist',
        'add',
        taskId,
        text,
        '--project',
        projectId,
      ]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(`Added [ ] ${text}`);
    }
    expect((await items(taskId)).map((item) => item.text)).toEqual([
      'write the test',
      'fix the bug',
    ]);

    const human = await h.runCli(['task', 'checklist', 'list', taskId, '--project', projectId]);
    expect(human.stdout).toContain('0/2 done');
  });

  it('honors --top and --after when placing an item', async () => {
    const taskId = await createCard('Placement flow');
    for (const text of ['first', 'second']) {
      expect(
        (await h.runCli(['task', 'checklist', 'add', taskId, text, '--project', projectId]))
          .exitCode
      ).toBe(0);
    }
    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'add',
          taskId,
          'zeroth',
          '--project',
          projectId,
          '--top',
        ])
      ).exitCode
    ).toBe(0);
    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'add',
          taskId,
          'middle',
          '--project',
          projectId,
          '--after',
          'first',
        ])
      ).exitCode
    ).toBe(0);

    expect((await items(taskId)).map((item) => item.text)).toEqual([
      'zeroth',
      'first',
      'middle',
      'second',
    ]);
  });

  it('resolves an item by a unique text substring for check, rename and remove', async () => {
    const taskId = await createCard('Resolution flow');
    for (const text of ['write the regression test', 'ship the release notes']) {
      expect(
        (await h.runCli(['task', 'checklist', 'add', taskId, text, '--project', projectId]))
          .exitCode
      ).toBe(0);
    }

    const checked = await h.runCli([
      'task',
      'checklist',
      'check',
      taskId,
      'regression',
      '--project',
      projectId,
    ]);
    expect(checked.exitCode).toBe(0);
    expect(checked.stdout).toContain('Updated [x] write the regression test');

    const renamed = await h.runCli([
      'task',
      'checklist',
      'rename',
      taskId,
      'regression',
      'write two regression tests',
      '--project',
      projectId,
    ]);
    expect(renamed.exitCode).toBe(0);
    expect((await items(taskId))[0]).toMatchObject({
      text: 'write two regression tests',
      checked: true,
    });

    const unchecked = await h.runCli([
      'task',
      'checklist',
      'uncheck',
      taskId,
      'regression',
      '--project',
      projectId,
    ]);
    expect(unchecked.exitCode).toBe(0);
    expect((await items(taskId))[0].checked).toBe(false);

    const removed = await h.runCli([
      'task',
      'checklist',
      'remove',
      taskId,
      'release notes',
      '--project',
      projectId,
      '--force',
    ]);
    expect(removed.exitCode).toBe(0);
    expect((await items(taskId)).map((item) => item.text)).toEqual(['write two regression tests']);
  });

  it('refuses to remove an item without --force under --no-input', async () => {
    const taskId = await createCard('Confirm flow');
    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'add',
          taskId,
          'needs confirming',
          '--project',
          projectId,
        ])
      ).exitCode
    ).toBe(0);

    const res = await h.runCli([
      'task',
      'checklist',
      'remove',
      taskId,
      'confirming',
      '--project',
      projectId,
      '--no-input',
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('pass --force');
    expect((await items(taskId)).map((item) => item.text)).toEqual(['needs confirming']);
  });

  it('exits 2 for a substring matching two items', async () => {
    const taskId = await createCard('Ambiguity flow');
    for (const text of ['review the plan', 'review the code']) {
      expect(
        (await h.runCli(['task', 'checklist', 'add', taskId, text, '--project', projectId]))
          .exitCode
      ).toBe(0);
    }
    const res = await h.runCli([
      'task',
      'checklist',
      'check',
      taskId,
      'review',
      '--project',
      projectId,
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Ambiguous checklist item');
  });

  it('moves an item with --top and with --after', async () => {
    const taskId = await createCard('Move flow');
    for (const text of ['alpha', 'beta', 'gamma']) {
      expect(
        (await h.runCli(['task', 'checklist', 'add', taskId, text, '--project', projectId]))
          .exitCode
      ).toBe(0);
    }
    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'move',
          taskId,
          'gamma',
          '--project',
          projectId,
          '--top',
        ])
      ).exitCode
    ).toBe(0);
    expect((await items(taskId)).map((item) => item.text)).toEqual(['gamma', 'alpha', 'beta']);

    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'move',
          taskId,
          'gamma',
          '--project',
          projectId,
          '--after',
          'alpha',
        ])
      ).exitCode
    ).toBe(0);
    expect((await items(taskId)).map((item) => item.text)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('reads Markdown list markers and tickboxes from stdin', async () => {
    const taskId = await createCard('Stdin flow');
    const res = await h.runCli(['task', 'checklist', 'add', taskId, '-', '--project', projectId], {
      stdin: '- [x] shipped\n* [ ] pending\n1. numbered\nplain\n\n',
    });
    expect(res.exitCode).toBe(0);
    expect((await items(taskId)).map((item) => [item.text, item.checked])).toEqual([
      ['shipped', true],
      ['pending', false],
      ['numbered', false],
      ['plain', false],
    ]);
  });

  it('refuses to drain a terminal', async () => {
    const taskId = await createCard('Tty flow');
    const res = await h.runCli(['task', 'checklist', 'add', taskId, '-', '--project', projectId], {
      stdinIsTty: true,
    });
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Pipe one item per line');
  });

  it('promotes an item into a card directly below its parent', async () => {
    const taskId = await createCard('Promote parent');
    const belowId = await createCard('Already below');
    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'add',
          taskId,
          'becomes its own card',
          '--project',
          projectId,
        ])
      ).exitCode
    ).toBe(0);

    const res = await h.runCli([
      'task',
      'checklist',
      'promote',
      taskId,
      'becomes',
      '--project',
      projectId,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const created = res.json<BoardTask>();
    expect(created.title).toBe('becomes its own card');
    expect(await items(taskId)).toEqual([]);

    const board = await h.runCli(['board', projectId, '--json']);
    expect(board.exitCode).toBe(0);
    const tasks = board
      .json<BoardResponse>()
      .tasks.filter((task) => task.column_id === created.column_id)
      .sort((a, b) => a.position - b.position)
      .map((task) => task.title);
    expect(tasks.indexOf(created.title)).toBe(tasks.indexOf('Promote parent') + 1);
    expect(tasks).toContain('Already below');
    expect(belowId).not.toBe(created.id);
  });

  it('shows the checklist in task show', async () => {
    const taskId = await createCard('Show flow');
    expect(
      (
        await h.runCli([
          'task',
          'checklist',
          'add',
          taskId,
          'visible in show',
          '--project',
          projectId,
        ])
      ).exitCode
    ).toBe(0);

    const res = await h.runCli(['task', 'show', taskId, '--project', projectId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Checklist: 0/1 done');
    expect(res.stdout).toContain('[ ] visible in show');
  });

  it('exits 4 for an item that does not exist', async () => {
    const taskId = await createCard('Missing flow');
    const res = await h.runCli([
      'task',
      'checklist',
      'check',
      taskId,
      'nothing like this',
      '--project',
      projectId,
    ]);
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toContain('No checklist item matching');
  });
});
