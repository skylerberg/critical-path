import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import { decodeId, encodeId } from '../../src/short-links';
import type { components } from '../../src/api/api.generated';

import { rankKey } from '../../../tests/helpers/fixtures';
type BoardPayload = components['schemas']['BoardResponse'];
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
    expect(
      [...board.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1)).map((c) => c.name)
    ).toEqual(['Backlog', 'To Do', 'In Progress', 'Done']);

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
    const backlog = [...source.columns].sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1))[0];
    const taskRes = await tc.request(user.token).post('/api/tasks', {
      id: crypto.randomUUID(),
      project_id: source.project.id,
      column_id: backlog.id,
      title: 'Copied task',
      sort_key: rankKey(1000),
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

  it('update sets and clears the accent colour and refuses one outside the palette', async () => {
    await createProject('Colour Me');

    const set = await h.runCli(['project', 'update', 'Colour Me', '--color', 'violet', '--json']);
    expect(set.exitCode).toBe(0);
    expect(set.json<Project>().color).toBe('violet');

    const shown = await h.runCli(['project', 'show', 'Colour Me']);
    expect(shown.stdout).toContain('Color: violet');

    const bad = await h.runCli(['project', 'update', 'Colour Me', '--color', 'chartreuse']);
    expect(bad.exitCode).toBe(2);

    const cleared = await h.runCli(['project', 'update', 'Colour Me', '--color', 'none', '--json']);
    expect(cleared.exitCode).toBe(0);
    expect(cleared.json<Project>().color).toBeNull();
  });

  it('update treats the global --no-color as output styling, not as an accent', async () => {
    await createProject('Plain Board');
    const coloured = await h.runCli([
      'project',
      'update',
      'Plain Board',
      '--color',
      'sky',
      '--json',
    ]);
    expect(coloured.exitCode).toBe(0);

    const renamed = await h.runCli([
      'project',
      'update',
      'Plain Board',
      '--name',
      'Plain Renamed',
      '--no-color',
      '--json',
    ]);
    expect(renamed.exitCode).toBe(0);
    expect(renamed.json<Project>().name).toBe('Plain Renamed');
    expect(renamed.json<Project>().color).toBe('sky');
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

  it('resolves a project by its short alias', async () => {
    const board = await createProject('Alias Board');
    const show = await h.runCli(['project', 'show', encodeId(board.project.id), '--json']);
    expect(show.exitCode).toBe(0);
    expect(show.json<BoardPayload>().project.id).toBe(board.project.id);
  });

  it('leaves a name that is shaped like an alias reachable by that name', async () => {
    // Decodes to a valid uuid, which is what lets a decode shadow a name.
    const name = 'ArchivedRoadmapQ3Notes';
    expect(decodeId(name)).not.toBeNull();
    const board = await createProject(name);
    const show = await h.runCli(['project', 'show', name, '--json']);
    expect(show.exitCode).toBe(0);
    expect(show.json<BoardPayload>().project.id).toBe(board.project.id);
  });

  // One past the largest uuid: well-formed, 22 characters, names nothing.
  it('rejects a well-formed alias that names no uuid', async () => {
    const show = await h.runCli(['project', 'show', 'HxECNQWFdpvuJxIw3HPrmI']);
    expect(show.exitCode).toBe(4);
  });

  // The reason the alphabet is alphanumeric. Under base64url this id encoded to
  // -KGyw9TlT2qLnA0eLzpLXA, which every CLI parser reads as an option, so the
  // command failed with a usage error instead of showing the board.
  it('shows a project whose id would once have encoded to a leading dash', async () => {
    // Chosen, not random: the first byte has to land in 0xf8-0xfb for the old
    // scheme to have produced a dash. POST takes the id, so the CLI need not.
    const id = 'f8a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b5c';
    const created = await tc.request(user.token).post('/api/projects', { id, name: 'Dash Board' });
    expect(created.status).toBe(201);
    projectIds.push(id);

    const alias = encodeId(id);
    expect(alias).toMatch(/^[A-Za-z0-9]{22}$/);
    const show = await h.runCli(['project', 'show', alias, '--json']);
    expect(show.exitCode).toBe(0);
    expect(show.json<BoardPayload>().project.id).toBe(id);
  });

  it('unresolvable project ref exits 4', async () => {
    const res = await h.runCli(['project', 'show', 'zz-no-such-project']);
    expect(res.exitCode).toBe(4);
  });
});
