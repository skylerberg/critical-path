import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { TestContext, type TestUser } from '../../../tests/setup/testContext';
import { createCliHarness, type CliHarness } from './helpers';
import type { components } from '../../src/api/api.generated';

type BoardPayload = components['schemas']['BoardPayload'];
type User = components['schemas']['User'];
type ProjectListItem = components['schemas']['ProjectListItem'];
type Member = { id: string; name: string | null; email: string | null; role: string };
type InviteResult = { user: User; role: string };

describe('project member commands', () => {
  const tc = new TestContext();
  const extraProjectIds: string[] = [];
  let user: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let h: CliHarness;
  let hMember: CliHarness;
  let projectId: string;

  beforeAll(async () => {
    user = await tc.createUser('cli-pm');
    member = await tc.createUser('cli-pm-member');
    outsider = await tc.createUser('cli-pm-outsider');
    h = await createCliHarness();
    await h.runCli(['login', '--email', user.email, '--password-stdin'], {
      stdin: `${user.password}\n`,
    });
    hMember = await createCliHarness();
    await hMember.runCli(['login', '--email', member.email, '--password-stdin'], {
      stdin: `${member.password}\n`,
    });

    const res = await h.runCli(['project', 'create', 'CLI Members Project', '--json']);
    expect(res.exitCode).toBe(0);
    projectId = res.json<BoardPayload>().project.id;
  });

  afterAll(async () => {
    // The transfer cases hand projectId to member and have user leave it.
    await tc.request(member.token).delete(`/api/projects/${projectId}`);
    for (const id of extraProjectIds) {
      await tc.request(user.token).delete(`/api/projects/${id}`);
    }
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
    expect(res.json<InviteResult>()).toMatchObject({ user: { id: member.id }, role: 'editor' });

    const again = await h.runCli(['project', 'invite', projectId, '--email', member.email]);
    expect(again.stdout).toContain(`to project CLI Members Project as editor`);

    const members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>()).toEqual([
      { id: user.id, name: user.name, email: user.email, role: 'owner' },
      { id: member.id, name: member.name, email: member.email, role: 'editor' },
    ]);
  });

  it('delete is refused for a member who is not the owner', async () => {
    await h.runCli(['project', 'invite', projectId, '--email', member.email]);

    const res = await hMember.runCli(['project', 'delete', projectId, '--force']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Only the project owner can delete this project');

    const list = await hMember.runCli(['project', 'list', '--json']);
    expect(list.json<ProjectListItem[]>().map((p) => p.id)).toContain(projectId);
  });

  it('invite with an unknown email creates a pending invitation it can list and revoke', async () => {
    const address = `cli-pending-${crypto.randomUUID()}@test.example.com`;
    const res = await h.runCli(['project', 'invite', projectId, '--email', address]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(`Invited ${address} to project`);
    expect(res.stdout).toContain('pending until they accept');

    const listed = await h.runCli(['project', 'invitations', projectId, '--json']);
    expect(listed.exitCode).toBe(0);
    const invitations = listed.json<{ id: string; email: string; role: string }[]>();
    expect(invitations.map((invitation) => invitation.email)).toContain(address);
    const invitation = invitations.find((entry) => entry.email === address)!;
    expect(invitation.role).toBe('editor');

    const table = await h.runCli(['project', 'invitations', projectId]);
    expect(table.stdout).toContain(address);
    expect(table.stdout).toMatch(/in 14 days/);

    const resent = await h.runCli([
      'project',
      'resend-invite',
      projectId,
      '--id',
      invitation.id,
      '--json',
    ]);
    expect(resent.exitCode).toBe(0);
    expect(resent.json<{ resent: boolean }>().resent).toBe(true);

    const revoked = await h.runCli(['project', 'revoke-invite', projectId, '--id', invitation.id]);
    expect(revoked.exitCode).toBe(0);
    expect(revoked.stdout).toContain('Revoked invitation');

    const after = await h.runCli(['project', 'invitations', projectId]);
    expect(after.stdout).toContain('No pending invitations');
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

  it('invite --role viewer stores and reports the viewer role', async () => {
    const res = await h.runCli([
      'project',
      'invite',
      projectId,
      '--email',
      member.email,
      '--role',
      'viewer',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.json<InviteResult>().role).toBe('viewer');

    const members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>().find((m) => m.id === member.id)?.role).toBe('viewer');
  });

  it('invite with an unknown --role exits 2 without sending a request', async () => {
    const res = await h.runCli([
      'project',
      'invite',
      projectId,
      '--email',
      member.email,
      '--role',
      'nonsense',
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toContain('--role must be editor or viewer');
  });

  it('set-members leaves an existing viewer’s role alone', async () => {
    const res = await h.runCli(['project', 'set-members', projectId, member.email, '--json']);
    expect(res.exitCode).toBe(0);

    const members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>().find((m) => m.id === member.id)?.role).toBe('viewer');
  });

  it('set-role flips a member between viewer and editor', async () => {
    const promote = await h.runCli([
      'project',
      'set-role',
      projectId,
      member.email,
      '--role',
      'editor',
      '--json',
    ]);
    expect(promote.exitCode).toBe(0);
    let members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>().find((m) => m.id === member.id)?.role).toBe('editor');

    const demote = await h.runCli([
      'project',
      'set-role',
      projectId,
      member.email,
      '--role',
      'viewer',
      '--json',
    ]);
    expect(demote.exitCode).toBe(0);
    members = await h.runCli(['project', 'members', projectId, '--json']);
    expect(members.json<Member[]>().find((m) => m.id === member.id)?.role).toBe('viewer');
  });

  it('set-role on the creator exits 2 without sending a request', async () => {
    const res = await h.runCli(['project', 'set-role', projectId, user.email, '--role', 'viewer']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/always an editor/);
  });

  it('a viewer cannot edit the board but can still read and leave it', async () => {
    const rename = await hMember.runCli(['project', 'update', projectId, '--name', 'Nope']);
    expect(rename.exitCode).not.toBe(0);
    expect(rename.stderr).toContain('Read-only access to this project');

    const show = await hMember.runCli(['project', 'show', projectId, '--json']);
    expect(show.exitCode).toBe(0);

    const leave = await hMember.runCli(['project', 'leave', projectId, '--force', '--json']);
    expect(leave.exitCode).toBe(0);

    const list = await hMember.runCli(['project', 'list', '--json']);
    expect(list.json<ProjectListItem[]>().map((p) => p.id)).not.toContain(projectId);
  });

  it('unresolvable project ref exits 4', async () => {
    const res = await h.runCli(['project', 'members', 'zz-no-such-project']);
    expect(res.exitCode).toBe(4);
  });

  it('transfer rejects a --to target with no project access before sending a request', async () => {
    const res = await h.runCli([
      'project',
      'transfer',
      projectId,
      '--to',
      outsider.email,
      '--force',
    ]);
    expect(res.exitCode).toBe(4);
    expect(res.stderr).toMatch(/No user matching/);
  });

  it('transfer hands the project to a member and demotes the caller', async () => {
    const invite = await h.runCli([
      'project',
      'invite',
      projectId,
      '--email',
      member.email,
      '--json',
    ]);
    expect(invite.exitCode).toBe(0);

    const res = await h.runCli([
      'project',
      'transfer',
      projectId,
      '--to',
      member.email,
      '--force',
      '--json',
    ]);
    expect(res.exitCode).toBe(0);
    const updated = res.json<components['schemas']['Project']>();
    expect(updated.created_by).toBe(member.id);
    expect(updated.member_ids).toEqual([user.id]);
  });

  it('members reflects the swapped roles after a transfer', async () => {
    const res = await h.runCli(['project', 'members', projectId, '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<Member[]>()).toEqual([
      { id: member.id, name: member.name, email: member.email, role: 'owner' },
      { id: user.id, name: user.name, email: user.email, role: 'editor' },
    ]);
  });

  it('transfer as a non-owner exits 1', async () => {
    const res = await h.runCli(['project', 'transfer', projectId, '--to', user.email, '--force']);
    expect(res.exitCode).toBe(1);
  });

  it('transfer without --force under --no-input exits 2', async () => {
    const res = await h.runCli([
      'project',
      'transfer',
      projectId,
      '--to',
      user.email,
      '--no-input',
    ]);
    expect(res.exitCode).toBe(2);
  });

  it('leave drops a project you no longer own', async () => {
    const res = await h.runCli(['project', 'leave', projectId, '--force', '--json']);
    expect(res.exitCode).toBe(0);
    expect(res.json<{ left: boolean; id: string }>()).toEqual({ left: true, id: projectId });

    const list = await h.runCli(['project', 'list', '--json']);
    expect(list.json<ProjectListItem[]>().map((p) => p.id)).not.toContain(projectId);
  });

  it('leave on a project you own exits 2 and points at transfer', async () => {
    const created = await h.runCli(['project', 'create', 'CLI Solo Project', '--json']);
    expect(created.exitCode).toBe(0);
    extraProjectIds.push(created.json<BoardPayload>().project.id);

    const res = await h.runCli(['project', 'leave', 'CLI Solo Project', '--force']);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/transfer it first/);
  });

  it('transfer to the project owner exits 2 without sending a request', async () => {
    const res = await h.runCli([
      'project',
      'transfer',
      'CLI Solo Project',
      '--to',
      user.email,
      '--force',
    ]);
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/already owns this project/);
  });
});
