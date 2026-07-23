import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type Project = components['schemas']['Project'];
type ProjectListItem = components['schemas']['ProjectListItem'];

describe('project commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let h: CliHarness;
  const projectIds: string[] = [];

  async function createProject(name: string, args: string[] = []): Promise<BoardPayload> {
    const res = await h.runCli(['project', 'create', name, ...args, '--json']);
    expect(res.exitCode).toBe(0);
    const board = res.json<BoardPayload>();
    projectIds.push(board.project.id);
    return board;
  }

  beforeAll(async () => {
    user = await tc.createUser('cli-project');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
  });

  afterAll(async () => {
    const client = tc.request(user.token);
    for (const id of projectIds) {
      await client.delete(`/api/projects/${id}`);
    }
    await tc.cleanup();
  });

  it('create makes a project with the default columns and list/show find it', async () => {
    const board = await createProject('Proj Alpha', ['--description', 'First project']);
    expect(board.project.description).toBe('First project');
    expect([...board.columns].sort((a, b) => a.position - b.position).map((c) => c.name)).toEqual([
      'Backlog',
      'To Do',
      'In Progress',
      'Done',
    ]);

    const list = await h.runCli(['project', 'list', '--json']);
    expect(list.exitCode).toBe(0);
    expect(list.json<ProjectListItem[]>().map((p) => p.id)).toContain(board.project.id);

    const show = await h.runCli(['project', 'show', 'Proj Alpha', '--json']);
    expect(show.exitCode).toBe(0);
    expect(show.json<BoardPayload>().project.id).toBe(board.project.id);

    const human = await h.runCli(['project', 'show', 'Proj Alpha']);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain('Proj Alpha');
    expect(human.stdout).toContain('Backlog');
  });

  it('create --from deep-copies the source project including tasks', async () => {
    const source = await createProject('Copy Source');
    const backlog = [...source.columns].sort((a, b) => a.position - b.position)[0];
    const taskRes = await tc.request(user.token).post('/api/tasks', {
      id: crypto.randomUUID(),
      project_id: source.project.id,
      column_id: backlog.id,
      title: 'Copied task',
      position: 1000,
    });
    expect(taskRes.status).toBe(201);

    const copy = await createProject('Copy Dest', ['--from', 'Copy Source']);
    expect(copy.project.id).not.toBe(source.project.id);
    expect(copy.tasks.map((t) => t.title)).toContain('Copied task');
  });

  it('update renames a project and requires at least one flag', async () => {
    await createProject('Update Me');
    const upd = await h.runCli([
      'project',
      'update',
      'Update Me',
      '--name',
      'Update Done',
      '--json',
    ]);
    expect(upd.exitCode).toBe(0);
    expect(upd.json<Project>().name).toBe('Update Done');

    const none = await h.runCli(['project', 'update', 'Update Done']);
    expect(none.exitCode).toBe(2);
  });

  it('archive hides a project from the default list and --archived shows it', async () => {
    const board = await createProject('Archive Me');
    const archive = await h.runCli(['project', 'archive', 'Archive Me', '--json']);
    expect(archive.exitCode).toBe(0);
    expect(archive.json<Project>().archived_at).not.toBeNull();

    const active = await h.runCli(['project', 'list', '--json']);
    expect(active.json<ProjectListItem[]>().map((p) => p.id)).not.toContain(board.project.id);

    const archived = await h.runCli(['project', 'list', '--archived']);
    expect(archived.exitCode).toBe(0);
    const line = archived.stdout.split('\n').find((l) => l.includes('Archive Me'));
    expect(line).toContain('archived');

    const unarchive = await h.runCli(['project', 'unarchive', 'Archive Me', '--json']);
    expect(unarchive.exitCode).toBe(0);
    expect(unarchive.json<Project>().archived_at).toBeNull();

    const again = await h.runCli(['project', 'list', '--json']);
    expect(again.json<ProjectListItem[]>().map((p) => p.id)).toContain(board.project.id);
  });

  it('templates are hidden by default and shown with --templates', async () => {
    const board = await createProject('Template Me', ['--template']);
    expect(board.project.is_template).toBe(true);

    const active = await h.runCli(['project', 'list', '--json']);
    expect(active.json<ProjectListItem[]>().map((p) => p.id)).not.toContain(board.project.id);

    const templates = await h.runCli(['project', 'list', '--templates', '--json']);
    expect(templates.json<ProjectListItem[]>().map((p) => p.id)).toContain(board.project.id);

    const all = await h.runCli(['project', 'list', '--all', '--json']);
    expect(all.json<ProjectListItem[]>().map((p) => p.id)).toContain(board.project.id);
  });

  it('delete refuses without confirmation under --no-input, then deletes with --force', async () => {
    const board = await createProject('Delete Me');

    const refused = await h.runCli(['project', 'delete', 'Delete Me', '--no-input']);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain('--force');

    const del = await h.runCli(['project', 'delete', 'Delete Me', '--force']);
    expect(del.exitCode).toBe(0);

    const list = await h.runCli(['project', 'list', '--all', '--json']);
    expect(list.json<ProjectListItem[]>().map((p) => p.id)).not.toContain(board.project.id);
  });

  it('ambiguous project ref exits 2', async () => {
    await createProject('Ambig One');
    await createProject('Ambig Two');
    const res = await h.runCli(['project', 'show', 'ambig']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('Ambiguous');
  });

  it('unresolvable project ref exits 4', async () => {
    const res = await h.runCli(['project', 'show', 'zz-no-such-project']);
    expect(res.exitCode).toBe(4);
  });
});
