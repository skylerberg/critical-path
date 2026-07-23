import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type Label = components['schemas']['Label'];

describe('label commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-label');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await h.runCli(['project', 'create', 'CLI Labels', '--json']);
    expect(create.exitCode).toBe(0);
    projectId = create.json<BoardPayload>().project.id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('create lowercases the color and list shows the label', async () => {
    const res = await h.runCli([
      'label',
      'create',
      'bug',
      '--project',
      projectId,
      '--color',
      '#FF0000',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<Label>().color).toBe('#ff0000');

    const list = await h.runCli(['label', 'list', '--project', projectId, '--json']);
    expect(list.exitCode).toBe(0);
    const labels = list.json<Label[]>();
    expect(labels.map((l) => l.name)).toContain('bug');

    const human = await h.runCli(['label', 'list', '--project', projectId]);
    expect(human.stdout).toContain('#ff0000');
  });

  it('duplicate label name exits 5', async () => {
    const res = await h.runCli([
      'label',
      'create',
      'bug',
      '--project',
      projectId,
      '--color',
      '#00ff00',
    ]);
    expect(res.exitCode).toBe(5);
  });

  it('invalid color exits 6', async () => {
    const res = await h.runCli([
      'label',
      'create',
      'shiny',
      '--project',
      projectId,
      '--color',
      'red',
    ]);
    expect(res.exitCode).toBe(6);
  });

  it('update renames and recolors, and requires at least one flag', async () => {
    const res = await h.runCli([
      'label',
      'update',
      'bug',
      '--project',
      projectId,
      '--name',
      'urgent',
      '--color',
      '#0000FF',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const updated = res.json<Label>();
    expect(updated.name).toBe('urgent');
    expect(updated.color).toBe('#0000ff');

    const none = await h.runCli(['label', 'update', 'urgent', '--project', projectId]);
    expect(none.exitCode).toBe(2);
  });

  it('delete removes the label', async () => {
    const res = await h.runCli([
      'label',
      'delete',
      'urgent',
      '--project',
      projectId,
      '--force',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);

    const list = await h.runCli(['label', 'list', '--project', projectId, '--json']);
    expect(list.json<Label[]>().map((l) => l.name)).not.toContain('urgent');
  });

  it('unresolvable label ref exits 4', async () => {
    const res = await h.runCli([
      'label',
      'update',
      'zz-nope',
      '--project',
      projectId,
      '--name',
      'other',
    ]);
    expect(res.exitCode).toBe(4);
  });
});
