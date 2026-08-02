import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects } from '../projects/helpers';
import { clearSentEmails, sentEmails } from '../../../src/services/email/index';
import { env } from '../../../src/config/env';
import {
  INVITE_RESEND_MAX_ATTEMPTS,
  INVITE_USER_MAX_ATTEMPTS,
  resetRateLimiter,
} from '../../../src/middleware/rateLimit';
import {
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS_PER_PROJECT,
  invitationTokenHash,
} from '../../../src/services/invitations';

interface InvitationBody {
  id: string;
  project_id: string;
  email: string;
  role: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
}

interface ByEmailBody {
  status: 'member' | 'invited';
  role: string;
  user: { id: string; email: string; name: string; avatar_url: string | null } | null;
  invitation: InvitationBody | null;
}

function inviteTokenFrom(text: string): string {
  const match = text.match(/\/invite\?token=(\S+)/);
  if (!match) {
    throw new Error(`No invitation token found in email text: ${text}`);
  }
  return decodeURIComponent(match[1]);
}

function invitationMailTo(address: string) {
  const mail = sentEmails().filter((message) => message.to === address);
  expect(mail).toHaveLength(1);
  return mail[0];
}

describe('Pending project invitations', () => {
  const ctx = new TestContext();
  const projectIds: string[] = [];
  const strayUserIds: string[] = [];
  let owner: TestUser;
  let member: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;

  beforeAll(async () => {
    process.env.EMAIL_DRIVER = 'memory';
    owner = await ctx.createUser('inv-owner');
    member = await ctx.createUser('inv-member');
    viewer = await ctx.createUser('inv-viewer');
    outsider = await ctx.createUser('inv-outsider');
  });

  afterAll(async () => {
    delete process.env.EMAIL_DRIVER;
    await deleteProjects(projectIds);
    if (strayUserIds.length > 0) {
      await db.deleteFrom('project').where('created_by', 'in', strayUserIds).execute();
      await db.deleteFrom('app_user').where('id', 'in', strayUserIds).execute();
    }
    await ctx.cleanup();
    resetRateLimiter();
  });

  beforeEach(() => {
    resetRateLimiter();
    clearSentEmails();
  });

  async function createProject(name: string, as: TestUser = owner): Promise<BoardPayloadBody> {
    const id = newId();
    projectIds.push(id);
    const res = await ctx.request(as.token).post('/api/projects', { id, name });
    expect(res.status).toBe(201);
    return (await res.json()) as BoardPayloadBody;
  }

  async function invite(
    projectId: string,
    email: string,
    role?: string,
    as: TestUser = owner
  ): Promise<ByEmailBody> {
    const res = await ctx
      .request(as.token)
      .post(`/api/projects/${projectId}/members/by-email`, { email, role });
    expect(res.status).toBe(200);
    return (await res.json()) as ByEmailBody;
  }

  async function invitationRows(projectId: string) {
    return db
      .selectFrom('project_invitation')
      .selectAll()
      .where('project_id', '=', projectId)
      .execute();
  }

  async function signUp(email: string): Promise<{ id: string; token: string }> {
    const id = newId();
    strayUserIds.push(id);
    const res = await ctx
      .request()
      .post('/api/auth/signup', { id, email, password: 'password-123', name: 'Invited Person' });
    expect(res.status).toBe(201);
    return { id, token: ((await res.json()) as { token: string }).token };
  }

  async function roleOf(projectId: string, userId: string): Promise<string | undefined> {
    const row = await db
      .selectFrom('project_member')
      .select('role')
      .where('project_id', '=', projectId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    return row?.role;
  }

  async function expireInvitation(invitationId: string): Promise<void> {
    await db
      .updateTable('project_invitation')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', invitationId)
      .execute();
  }

  describe('inviting an address with no account', () => {
    it('creates one invitation, mails a link, and never returns the token', async () => {
      const board = await createProject('inv create');
      const address = uniqueEmail('inv-new');

      const body = await invite(board.project.id, address);
      expect(body.status).toBe('invited');
      expect(body.role).toBe('editor');
      expect(body.user).toBeNull();
      expect(body.invitation).toMatchObject({
        project_id: board.project.id,
        email: address,
        role: 'editor',
        invited_by: owner.id,
      });

      const rows = await invitationRows(board.project.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].email_lower).toBe(address.toLowerCase());
      expect(await roleOf(board.project.id, owner.id)).toBeUndefined();

      const mail = invitationMailTo(address);
      expect(mail.text).toContain(`${env.appUrlBase}/invite?token=`);

      const token = inviteTokenFrom(mail.text);
      expect(JSON.stringify(body)).not.toContain(token);
      expect(JSON.stringify(body)).not.toContain(rows[0].token_hash);
      expect(invitationTokenHash(rows[0].id)).toBe(rows[0].token_hash);
    });

    it('keeps the casing the inviter typed', async () => {
      const board = await createProject('inv casing');
      const address = uniqueEmail('Inv-Casing');

      const body = await invite(board.project.id, address);
      expect(body.invitation?.email).toBe(address);
      expect(invitationMailTo(address).to).toBe(address);
    });

    it('re-inviting the same address keeps one row, one link, and extends the deadline', async () => {
      const board = await createProject('inv reinvite');
      const address = uniqueEmail('inv-again');

      const first = await invite(board.project.id, address);
      const firstToken = inviteTokenFrom(invitationMailTo(address).text);
      const firstRow = (await invitationRows(board.project.id))[0];

      clearSentEmails();
      const second = await invite(board.project.id, address.toUpperCase());
      expect(second.invitation?.id).toBe(first.invitation?.id);

      const rows = await invitationRows(board.project.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].token_hash).toBe(firstRow.token_hash);
      expect(rows[0].expires_at.getTime()).toBeGreaterThanOrEqual(firstRow.expires_at.getTime());
      // The link already in the mailbox has to keep working, so a re-invite
      // must not rotate the token.
      expect(inviteTokenFrom(invitationMailTo(address).text)).toBe(firstToken);
    });

    it('changes the invited role only when a role is supplied', async () => {
      const board = await createProject('inv role');
      const address = uniqueEmail('inv-role');

      await invite(board.project.id, address, 'viewer');
      expect((await invitationRows(board.project.id))[0].role).toBe('viewer');

      const omitted = await invite(board.project.id, address);
      expect(omitted.role).toBe('viewer');

      const promoted = await invite(board.project.id, address, 'editor');
      expect(promoted.role).toBe('editor');
      expect((await invitationRows(board.project.id))[0].role).toBe('editor');
    });

    it('invites one address to several projects independently', async () => {
      const first = await createProject('inv fanout a');
      const second = await createProject('inv fanout b');
      const address = uniqueEmail('inv-fanout');

      await invite(first.project.id, address);
      clearSentEmails();
      await invite(second.project.id, address, 'viewer');

      expect(await invitationRows(first.project.id)).toHaveLength(1);
      expect(await invitationRows(second.project.id)).toHaveLength(1);
      expect(invitationMailTo(address).text).toContain('/invite?token=');
    });
  });

  describe('inviting an address that already has an account', () => {
    it('adds the member immediately and creates no invitation', async () => {
      const board = await createProject('inv existing');

      const body = await invite(board.project.id, member.email.toUpperCase());
      expect(body.status).toBe('member');
      expect(body.user?.id).toBe(member.id);
      expect(body.invitation).toBeNull();
      expect(await invitationRows(board.project.id)).toEqual([]);
      expect(sentEmails()).toEqual([]);
    });

    it('treats the creator’s own address as a no-op', async () => {
      const board = await createProject('inv creator');

      const body = await invite(board.project.id, owner.email);
      expect(body.status).toBe('member');
      expect(body.role).toBe('editor');
      expect(await invitationRows(board.project.id)).toEqual([]);
      expect(await roleOf(board.project.id, owner.id)).toBeUndefined();
      expect(sentEmails()).toEqual([]);
    });
  });

  describe('signing up later', () => {
    it('claims every unexpired invitation for the address, at the invited role, with no mail about it', async () => {
      const first = await createProject('inv signup a');
      const second = await createProject('inv signup b');
      const address = uniqueEmail('inv-signup');

      await invite(first.project.id, address);
      await invite(second.project.id, address, 'viewer');

      clearSentEmails();
      const account = await signUp(address);

      expect(await roleOf(first.project.id, account.id)).toBe('editor');
      expect(await roleOf(second.project.id, account.id)).toBe('viewer');
      expect(await invitationRows(first.project.id)).toEqual([]);
      expect(await invitationRows(second.project.id)).toEqual([]);

      const board = await ctx.request(account.token).get(`/api/projects/${first.project.id}`);
      expect(board.status).toBe(200);

      // Only the verification mail: joining a board you were invited to is not
      // news worth mailing about.
      expect(sentEmails().map((message) => message.subject)).toEqual([
        expect.stringContaining('Verify'),
      ]);
    });

    it('ignores an expired invitation and leaves the account with no access', async () => {
      const board = await createProject('inv signup expired');
      const address = uniqueEmail('inv-signup-expired');

      const body = await invite(board.project.id, address);
      await expireInvitation(body.invitation!.id);

      const account = await signUp(address);
      expect(await roleOf(board.project.id, account.id)).toBeUndefined();
      expect(
        (await ctx.request(account.token).get(`/api/projects/${board.project.id}`)).status
      ).toBe(404);
      expect(await invitationRows(board.project.id)).toHaveLength(1);
    });

    it('ignores a revoked invitation', async () => {
      const board = await createProject('inv signup revoked');
      const address = uniqueEmail('inv-signup-revoked');

      const body = await invite(board.project.id, address);
      const revoke = await ctx
        .request(owner.token)
        .delete(`/api/projects/${board.project.id}/invitations/${body.invitation!.id}`);
      expect(revoke.status).toBe(204);

      const account = await signUp(address);
      expect(await roleOf(board.project.id, account.id)).toBeUndefined();
    });

    it('never claims an invitation on an address change, only at signup', async () => {
      const board = await createProject('inv address change');
      const address = uniqueEmail('inv-later-claim');
      await invite(board.project.id, address);

      const mover = await ctx.createUser('inv-mover');
      const patch = await ctx.request(mover.token).patch('/api/auth/me', { email: address });
      expect(patch.status).toBe(200);

      expect(await roleOf(board.project.id, mover.id)).toBeUndefined();
      expect(await invitationRows(board.project.id)).toHaveLength(1);
    });
  });

  describe('POST /api/invitations/accept', () => {
    it('joins the board for a signed-in caller whose address is not the invited one', async () => {
      const board = await createProject('inv accept other');
      const address = uniqueEmail('inv-accept-other');
      await invite(board.project.id, address, 'viewer');
      const token = inviteTokenFrom(invitationMailTo(address).text);

      const res = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ project_id: board.project.id, role: 'viewer' });
      expect(await roleOf(board.project.id, outsider.id)).toBe('viewer');
      expect(await invitationRows(board.project.id)).toEqual([]);

      const second = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(second.status).toBe(422);
      expect(await roleOf(board.project.id, outsider.id)).toBe('viewer');
    });

    it('never demotes someone who is already a member', async () => {
      const board = await createProject('inv accept no demote');
      const address = uniqueEmail('inv-accept-editor');
      await invite(board.project.id, address, 'viewer');
      const token = inviteTokenFrom(invitationMailTo(address).text);

      await invite(board.project.id, member.email, 'editor');

      const res = await ctx.request(member.token).post('/api/invitations/accept', { token });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ project_id: board.project.id, role: 'editor' });
      expect(await roleOf(board.project.id, member.id)).toBe('editor');
    });

    it('answers 422 for an expired invitation and grants nothing', async () => {
      const board = await createProject('inv accept expired');
      const address = uniqueEmail('inv-accept-expired');
      const body = await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);
      await expireInvitation(body.invitation!.id);

      const res = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('This invitation has expired');
      expect(await roleOf(board.project.id, outsider.id)).toBeUndefined();
    });

    it('answers 422 for a revoked invitation, with the same message as an unknown token', async () => {
      const board = await createProject('inv accept revoked');
      const address = uniqueEmail('inv-accept-revoked');
      const body = await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);

      expect(
        (
          await ctx
            .request(owner.token)
            .delete(`/api/projects/${board.project.id}/invitations/${body.invitation!.id}`)
        ).status
      ).toBe(204);

      const revoked = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(revoked.status).toBe(422);
      expect((await revoked.json()).error).toBe('This invitation is no longer valid');

      const unknown = await ctx
        .request(outsider.token)
        .post('/api/invitations/accept', { token: 'not-a-real-token' });
      expect(unknown.status).toBe(422);
      expect((await unknown.json()).error).toBe('This invitation is no longer valid');
      expect(await roleOf(board.project.id, outsider.id)).toBeUndefined();
    });

    it('dies with the board: deleting the project revokes every invitation on it', async () => {
      const board = await createProject('inv accept deleted');
      const address = uniqueEmail('inv-accept-deleted');
      await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);

      expect(
        (await ctx.request(owner.token).delete(`/api/projects/${board.project.id}`)).status
      ).toBe(204);
      expect(await invitationRows(board.project.id)).toEqual([]);

      const res = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(res.status).toBe(422);
    });

    it('requires a session, and the token itself is not one', async () => {
      const board = await createProject('inv accept anon');
      const address = uniqueEmail('inv-accept-anon');
      await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);

      expect((await ctx.request().post('/api/invitations/accept', { token })).status).toBe(401);
      expect((await ctx.request(token).get('/api/auth/me')).status).toBe(401);
      expect(await invitationRows(board.project.id)).toHaveLength(1);
    });
  });

  describe('managing the pending list', () => {
    it('lists expired invitations with their deadline instead of dropping them', async () => {
      const board = await createProject('inv list expired');
      const address = uniqueEmail('inv-list-expired');
      const body = await invite(board.project.id, address);
      await expireInvitation(body.invitation!.id);

      const res = await ctx
        .request(owner.token)
        .get(`/api/projects/${board.project.id}/invitations`);
      expect(res.status).toBe(200);
      const { invitations } = (await res.json()) as { invitations: InvitationBody[] };
      expect(invitations).toHaveLength(1);
      expect(invitations[0].email).toBe(address);
      expect(new Date(invitations[0].expires_at).getTime()).toBeLessThan(Date.now());
    });

    it('resending revives an expired invitation without changing its link', async () => {
      const board = await createProject('inv resend');
      const address = uniqueEmail('inv-resend');
      const body = await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);
      await expireInvitation(body.invitation!.id);

      clearSentEmails();
      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${board.project.id}/invitations/${body.invitation!.id}/resend`);
      expect(res.status).toBe(204);
      expect(inviteTokenFrom(invitationMailTo(address).text)).toBe(token);

      const accept = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(accept.status).toBe(200);
    });

    it('answers 404 for an invitation belonging to another project', async () => {
      const mine = await createProject('inv scope mine');
      const other = await createProject('inv scope other');
      const address = uniqueEmail('inv-scope');
      const body = await invite(other.project.id, address);

      const del = await ctx
        .request(owner.token)
        .delete(`/api/projects/${mine.project.id}/invitations/${body.invitation!.id}`);
      expect(del.status).toBe(404);

      const resend = await ctx
        .request(owner.token)
        .post(`/api/projects/${mine.project.id}/invitations/${body.invitation!.id}/resend`);
      expect(resend.status).toBe(404);
      expect(await invitationRows(other.project.id)).toHaveLength(1);
    });
  });

  describe('authorization', () => {
    async function boardWithViewer(): Promise<string> {
      const board = await createProject('inv authz');
      expect(
        (
          await ctx.request(owner.token).put(`/api/projects/${board.project.id}/members`, {
            user_ids: [viewer.id],
            roles: [{ user_id: viewer.id, role: 'viewer' }],
          })
        ).status
      ).toBe(204);
      return board.project.id;
    }

    it('gives a viewer 403 and a non-member 404 on every invitation route', async () => {
      const projectId = await boardWithViewer();
      const address = uniqueEmail('inv-authz');
      const body = await invite(projectId, address);
      const invitationId = body.invitation!.id;

      const calls = (token: string) => [
        ctx.request(token).get(`/api/projects/${projectId}/invitations`),
        ctx.request(token).delete(`/api/projects/${projectId}/invitations/${invitationId}`),
        ctx.request(token).post(`/api/projects/${projectId}/invitations/${invitationId}/resend`),
        ctx
          .request(token)
          .post(`/api/projects/${projectId}/members/by-email`, { email: uniqueEmail('inv-probe') }),
      ];

      for (const res of await Promise.all(calls(viewer.token))) {
        expect(res.status).toBe(403);
      }
      for (const res of await Promise.all(calls(outsider.token))) {
        expect(res.status).toBe(404);
      }
      for (const res of await Promise.all(calls(''))) {
        expect(res.status).toBe(401);
      }

      expect(await invitationRows(projectId)).toHaveLength(1);
    });

    it('answers a viewer identically whether or not the address has an account', async () => {
      const projectId = await boardWithViewer();

      const known = await ctx
        .request(viewer.token)
        .post(`/api/projects/${projectId}/members/by-email`, { email: member.email });
      const unknown = await ctx
        .request(viewer.token)
        .post(`/api/projects/${projectId}/members/by-email`, {
          email: uniqueEmail('inv-viewer-probe'),
        });

      expect(known.status).toBe(403);
      expect(unknown.status).toBe(403);
      expect(await known.json()).toEqual(await unknown.json());
      expect(sentEmails()).toEqual([]);
    });

    it('answers a non-member identically whether or not the address has an account', async () => {
      const board = await createProject('inv outsider probe');

      const known = await ctx
        .request(outsider.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, { email: member.email });
      const unknown = await ctx
        .request(outsider.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, {
          email: uniqueEmail('inv-outsider-probe'),
        });

      expect(known.status).toBe(404);
      expect(unknown.status).toBe(404);
      expect(await known.json()).toEqual(await unknown.json());
      expect(sentEmails()).toEqual([]);
    });
  });

  describe('limits', () => {
    it('refuses a project past the pending-invitation cap', async () => {
      const board = await createProject('inv cap');
      const rows = Array.from({ length: MAX_PENDING_INVITATIONS_PER_PROJECT }, () => {
        const id = newId();
        return {
          id,
          project_id: board.project.id,
          email: uniqueEmail('inv-cap'),
          role: 'editor',
          invited_by: owner.id,
          token_hash: invitationTokenHash(id),
          expires_at: new Date(Date.now() + INVITATION_TTL_MS),
        };
      });
      await db.insertInto('project_invitation').values(rows).execute();

      const res = await ctx
        .request(owner.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, {
          email: uniqueEmail('inv-cap-over'),
        });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('This project has too many pending invitations');
      expect(sentEmails()).toEqual([]);

      // An address already invited is an update, not a new row, so the cap
      // never blocks re-inviting someone.
      const again = await ctx
        .request(owner.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, { email: rows[0].email });
      expect(again.status).toBe(200);
    });

    it('answers 429 past the hourly invitation budget, having mailed exactly the budget', async () => {
      const board = await createProject('inv budget');

      for (let i = 0; i < INVITE_USER_MAX_ATTEMPTS; i++) {
        const res = await ctx
          .request(owner.token)
          .post(`/api/projects/${board.project.id}/members/by-email`, {
            email: uniqueEmail(`inv-budget-${i}`),
          });
        expect(res.status).toBe(200);
      }
      expect(sentEmails()).toHaveLength(INVITE_USER_MAX_ATTEMPTS);

      const throttled = await ctx
        .request(owner.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, {
          email: uniqueEmail('inv-budget-over'),
        });
      expect(throttled.status).toBe(429);
      expect(sentEmails()).toHaveLength(INVITE_USER_MAX_ATTEMPTS);
      expect(await invitationRows(board.project.id)).toHaveLength(INVITE_USER_MAX_ATTEMPTS);
    });

    it('answers 429 past the per-invitation resend budget', async () => {
      const board = await createProject('inv resend budget');
      const address = uniqueEmail('inv-resend-budget');
      const body = await invite(board.project.id, address);
      const path = `/api/projects/${board.project.id}/invitations/${body.invitation!.id}/resend`;

      clearSentEmails();
      for (let i = 0; i < INVITE_RESEND_MAX_ATTEMPTS; i++) {
        expect((await ctx.request(owner.token).post(path)).status).toBe(204);
      }
      expect((await ctx.request(owner.token).post(path)).status).toBe(429);
      expect(sentEmails()).toHaveLength(INVITE_RESEND_MAX_ATTEMPTS);
    });
  });

  describe('exposure', () => {
    it('keeps invited addresses out of every payload that is not the invitation list', async () => {
      const board = await createProject('inv exposure');
      const address = uniqueEmail('inv-exposure');
      await invite(board.project.id, address);
      await invite(board.project.id, member.email);

      const payloads = await Promise.all([
        ctx.request(owner.token).get(`/api/projects/${board.project.id}`),
        ctx.request(owner.token).get('/api/projects'),
        ctx.request(owner.token).get(`/api/users?project_id=${board.project.id}`),
        ctx.request(member.token).get(`/api/projects/${board.project.id}`),
      ]);
      for (const res of payloads) {
        expect(res.status).toBe(200);
        expect(JSON.stringify(await res.json())).not.toContain(address);
      }

      const list = await ctx
        .request(owner.token)
        .get(`/api/projects/${board.project.id}/invitations`);
      expect(JSON.stringify(await list.json())).toContain(address);
    });
  });
});
