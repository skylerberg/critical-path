import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { completionCachePath } from '../../src/completion/cache';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];

function candidateValues(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split('\t')[0]);
}

describe('completion commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  let projectId: string;
  let secondProjectId: string;

  async function complete(words: string[]): Promise<{ exitCode: number; values: string[] }> {
    const res = await h.runCli(['__complete', '--', 'cpath', ...words]);
    expect(res.stderr).toBe('');
    return { exitCode: res.exitCode, values: candidateValues(res.stdout) };
  }

  beforeAll(async () => {
    user = await tc.createUser('cli-completion');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    const create = await h.runCli(['project', 'create', 'Completion Fixture', '--json']);
    expect(create.exitCode).toBe(0);
    projectId = create.json<BoardPayload>().project.id;

    const second = await h.runCli(['project', 'create', 'Completion Fixture Two', '--json']);
    expect(second.exitCode).toBe(0);
    secondProjectId = second.json<BoardPayload>().project.id;

    for (const argv of [
      ['label', 'create', 'urgent', '--project', projectId, '--color', '#ff0000'],
      ['task', 'create', 'Alpha task', '--project', projectId],
      ['task', 'create', 'Beta task', '--project', projectId],
    ]) {
      expect((await h.runCli(argv)).exitCode).toBe(0);
    }
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.request(user.token).delete(`/api/projects/${secondProjectId}`);
    await tc.cleanup();
  });

  it('prints an installable script for each shell', async () => {
    const expected: Record<string, string> = {
      bash: 'complete -o default -o bashdefault -F _cpath cpath',
      zsh: '#compdef cpath',
      fish: 'complete -c cpath',
    };
    for (const [shell, marker] of Object.entries(expected)) {
      const res = await h.runCli(['completion', '-s', shell]);
      expect(res.exitCode).toBe(0);
      expect(res.stdout).toContain(marker);
    }
  });

  it('rejects a missing or unsupported shell as a usage error', async () => {
    const missing = await h.runCli(['completion']);
    expect(missing.exitCode).toBe(2);
    expect(missing.stderr).not.toBe('');

    const unsupported = await h.runCli(['completion', '-s', 'tcsh']);
    expect(unsupported.exitCode).toBe(2);
    expect(unsupported.stderr).toContain('bash, zsh, fish');
  });

  it('keeps the completion helper out of the help output', async () => {
    const res = await h.runCli(['--help']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('completion');
    expect(res.stdout).not.toContain('__complete');
  });

  it('completes subcommands and filters them by the typed prefix', async () => {
    const all = await complete(['']);
    expect(all.exitCode).toBe(0);
    expect(all.values).toEqual(expect.arrayContaining(['task', 'project']));

    const filtered = await complete(['ta']);
    expect(filtered.values).toEqual(['task']);
  });

  it('completes columns, labels, tasks, and members of the named project', async () => {
    const columns = await complete(['task', 'list', '--project', projectId, '--column', '']);
    expect(columns.values).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);

    const labels = await complete(['task', 'list', '--project', projectId, '--label', '']);
    expect(labels.values).toEqual(['urgent']);

    const tasks = await complete([
      'task',
      'block',
      'Alpha task',
      '--project',
      projectId,
      '--by',
      '',
    ]);
    expect(tasks.values).toEqual(expect.arrayContaining(['Alpha task', 'Beta task']));

    const assignees = await complete(['task', 'list', '--project', projectId, '--assignee', '']);
    expect(assignees.values).toContain(user.email);
  });

  it('filters entity candidates case-insensitively', async () => {
    const exact = await complete(['task', 'list', '--project', projectId, '--column', 'Bac']);
    expect(exact.values).toEqual(['Backlog']);

    const lowered = await complete(['task', 'list', '--project', projectId, '--column', 'bac']);
    expect(lowered.values).toEqual(['Backlog']);
  });

  it('resolves a quoted project name containing spaces', async () => {
    const res = await complete([
      'task',
      'list',
      '--project',
      "'Completion Fixture Two'",
      '--column',
      '',
    ]);
    expect(res.values).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
  });

  it('emits well-formed candidate lines', async () => {
    const res = await h.runCli([
      '__complete',
      '--',
      'cpath',
      'task',
      'list',
      '--project',
      projectId,
      '--column',
      '',
    ]);
    const lines = res.stdout.split('\n').filter((line) => line !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.split('\t')).toHaveLength(2);
      expect(line.split('\t')[0]).not.toBe('');
    }
  });

  it('asks the shell for file completion on a path argument', async () => {
    const res = await h.runCli([
      '__complete',
      '--',
      'cpath',
      'image',
      'upload',
      'Alpha task',
      '--project',
      projectId,
      '',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe(':files\n');
  });

  it('caches the entities it fetched', async () => {
    const parsed: unknown = JSON.parse(await readFile(completionCachePath(h.configDir), 'utf8'));
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  it('scopes entity completion to the configured default project', async () => {
    const set = await h.runCli(['config', 'set', 'default-project', 'Completion Fixture']);
    expect(set.exitCode).toBe(0);

    const res = await complete(['task', 'list', '--column', '']);
    expect(res.values).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);
  });

  it('says nothing when the reference cannot be resolved', async () => {
    const unknownProject = await complete([
      'task',
      'list',
      '--project',
      'zz-no-such-project',
      '--column',
      '',
    ]);
    expect(unknownProject.exitCode).toBe(0);
    expect(unknownProject.values).toEqual([]);
  });

  it('says nothing when authentication fails, but still completes subcommands', async () => {
    const env = {
      CRITICAL_PATH_CONFIG_DIR: join(await mkdtemp(join(tmpdir(), 'cpath-anon-')), 'config'),
      CRITICAL_PATH_TOKEN: 'not-a-token',
    };

    const entities = await h.runCli(
      ['__complete', '--', 'cpath', 'task', 'list', '--project', projectId, '--column', ''],
      { env }
    );
    expect(entities.exitCode).toBe(0);
    expect(entities.stdout).toBe('');
    expect(entities.stderr).toBe('');

    const noProjectConfigured = await h.runCli(
      ['__complete', '--', 'cpath', 'task', 'list', '--column', ''],
      { env }
    );
    expect(noProjectConfigured.exitCode).toBe(0);
    expect(noProjectConfigured.stdout).toBe('');
    expect(noProjectConfigured.stderr).toBe('');

    const subcommands = await h.runCli(['__complete', '--', 'cpath', ''], { env });
    expect(subcommands.exitCode).toBe(0);
    expect(candidateValues(subcommands.stdout)).toContain('task');
    expect(subcommands.stderr).toBe('');
  });
});
