import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type User = components['schemas']['User'];
type ProjectListItem = components['schemas']['ProjectListItem'];
type Member = { id: string; name: string | null; email: string | null; role: string };

describe('project member commands', () => {
  const tc = new TestContext();
  let user: TestUser;
  let member: TestUser;
  let h: CliHarness;
  let projectId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-pm');
    member = await tc.createUser('cli-pm-member');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });

    const res = await h.runCli(['project', 'create', 'CLI Members Project', '--json']);
    expect(res.exitCode).toBe(0);
    projectId = res.json<BoardPayload>().project.id;
  });

  afterAll(async () => {
    await tc.request(user.token).delete(`/api/projects/${projectId}`);
    await tc.cleanup();
  });

  it('members lists only the implicit owner on a fresh project', async () => {
    const res = await h.runCli(['project', 'members', 'CLI Members Project', '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<Member[]>()).toEqual([
      { id: user.id, name: user.name, email: user.email, role: 'owner' },
    ]);
  });

  it('invite adds a member by email', async () => {
    const res = await h.runCli([
      'project',
      'invite',
      'CLI Members Project',
      '--email',
      member.email,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<User>().id).toBe(member.id);

    const members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>()).toEqual([
      { id: user.id, name: user.name, email: user.email, role: 'owner' },
      { id: member.id, name: member.name, email: member.email, role: 'member' },
    ]);
  });

  it('invite with an unknown email exits 4', async () => {
    const res = await h.runCli([
      'project',
      'invite',
      projectId,
      '--email',
      'nobody-zz@test.example.com',
    ]);
    expect(res.exitCode).toBe(4);
  });

  it('set-members replaces the member list and strips the owner', async () => {
    const res = await h.runCli([
      'project',
      'set-members',
      projectId,
      user.email,
      member.email,
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<ProjectListItem>().member_ids).toEqual([member.id]);
  });

  it('set-members can remove everyone but the owner', async () => {
    const res = await h.runCli(['project', 'set-members', projectId, user.email, '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<ProjectListItem>().member_ids).toEqual([]);

    const members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>().map((m) => m.id)).toEqual([user.id]);
  });

  it('unresolvable project ref exits 4', async () => {
    const res = await h.runCli(['project', 'members', 'zz-no-such-project']);
    expect(res.exitCode).toBe(4);
  });
});
