import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type Workspace = components['schemas']['Workspace'];
type User = components['schemas']['User'];
type Member = { id: string; name: string | null; email: string | null };

describe('workspace commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let member: TestUser;
  let h: CliHarness;
  let workspaceId: string;
  let deleted = false;

  beforeAll(async () => {
    user = await tc.createUser('cli-ws');
    member = await tc.createUser('cli-ws-member');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
  });

  afterAll(async () => {
    if (!deleted) {
      await tc.request(user.token).delete(`/api/workspaces/${workspaceId}`);
    }
    await tc.cleanup();
  });

  it('create adds the creator as the only member and list shows it', async () => {
    const res = await h.runCli(['workspace', 'create', 'CLI Workspace', '--json']);
    expect(res.exitCode).toBe(0);
    const created = res.json<Workspace>();
    workspaceId = created.id;
    expect(created.member_ids).toEqual([user.id]);

    const list = await h.runCli(['workspace', 'list', '--json']);
    expect(list.exitCode).toBe(0);
    expect(list.json<Workspace[]>().map((w) => w.id)).toContain(workspaceId);

    const members = await h.runCli(['workspace', 'members', 'CLI Workspace', '--json']);
    expect(members.exitCode).toBe(0);
    expect(members.json<Member[]>()).toEqual([{ id: user.id, name: user.name, email: user.email }]);
  });

  it('rename changes the name', async () => {
    const res = await h.runCli([
      'workspace',
      'rename',
      'CLI Workspace',
      'CLI WS Renamed',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<Workspace>().name).toBe('CLI WS Renamed');
  });

  it('invite adds a member by email', async () => {
    const res = await h.runCli([
      'workspace',
      'invite',
      'CLI WS Renamed',
      '--email',
      member.email,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<User>().id).toBe(member.id);

    const members = await h.runCli(['workspace', 'members', workspaceId, '--json']);
    expect(
      members
        .json<Member[]>()
        .map((m) => m.id)
        .sort()
    ).toEqual([user.id, member.id].sort());
  });

  it('invite with an unknown email exits 4', async () => {
    const res = await h.runCli([
      'workspace',
      'invite',
      workspaceId,
      '--email',
      'nobody-zz@test.example.com',
    ]);
    expect(res.exitCode).toBe(4);
  });

  it('set-members must include the caller', async () => {
    const res = await h.runCli(['workspace', 'set-members', workspaceId, member.email]);
    expect(res.exitCode).toBe(6);
  });

  it('set-members replaces the member list', async () => {
    const res = await h.runCli(['workspace', 'set-members', workspaceId, user.email, '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<Workspace>().member_ids).toEqual([user.id]);
  });

  it('delete removes the workspace', async () => {
    const res = await h.runCli(['workspace', 'delete', 'CLI WS Renamed', '--force', '--json']);
    expect(res.exitCode).toBe(0);
    deleted = true;

    const list = await h.runCli(['workspace', 'list', '--json']);
    expect(list.json<Workspace[]>().map((w) => w.id)).not.toContain(workspaceId);
  });

  it('unresolvable workspace ref exits 4', async () => {
    const res = await h.runCli(['workspace', 'members', 'zz-no-such-workspace']);
    expect(res.exitCode).toBe(4);
  });
});
