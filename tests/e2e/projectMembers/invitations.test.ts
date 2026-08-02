import { describe, it, expect, afterAll, beforeAll, beforeEach } from 'vitest';
import { TestContext, TestUser } from '../../setup/testContext';
import { db, waitForLockWaiters } from '../../helpers/database';
import { newId, uniqueEmail } from '../../helpers/fixtures';
import { BoardPayloadBody, deleteProjects, insertTask } from '../projects/helpers';
import { subscribeBus, type BusEntry } from '../../../src/services/realtime/bus';
import { clearSentEmails, sentEmails } from '../../../src/services/email/index';
import { env } from '../../../src/config/env';
import {
  INVITE_LOOKUP_MAX_ATTEMPTS,
  INVITE_RESEND_MAX_ATTEMPTS,
  INVITE_SEND_MAX_ATTEMPTS,
  resetRateLimiter,
} from '../../../src/middleware/rateLimit';
import {
  INVITATION_TTL_MS,
  MAX_PENDING_INVITATIONS_PER_PROJECT,
  claimInvitations,
  invitationToken,
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

async function collectBusEntries(run: () => Promise<void>): Promise<BusEntry[]> {
  const seen: BusEntry[] = [];
  const unsubscribe = subscribeBus((entry) => seen.push(entry));
  try {
    await run();
  } finally {
    unsubscribe();
  }
  return seen;
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

    it('re-inviting the same address keeps one row and one link', async () => {
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
      // The link already in the mailbox has to keep working, so a re-invite
      // must not rotate the token.
      expect(inviteTokenFrom(invitationMailTo(address).text)).toBe(firstToken);
    });

    it('re-inviting a lapsed address extends the deadline and makes its link work again', async () => {
      const board = await createProject('inv reinvite expiry');
      const address = uniqueEmail('inv-reinvite-expiry');

      const first = await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);
      await expireInvitation(first.invitation!.id);
      const lapsed = (await invitationRows(board.project.id))[0];
      expect(
        (await ctx.request(outsider.token).post('/api/invitations/accept', { token })).status
      ).toBe(422);

      await invite(board.project.id, address);

      const rows = await invitationRows(board.project.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].expires_at.getTime()).toBeGreaterThan(lapsed.expires_at.getTime());
      const accept = await ctx.request(outsider.token).post('/api/invitations/accept', { token });
      expect(accept.status).toBe(200);
      expect(await roleOf(board.project.id, outsider.id)).toBe('editor');
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

    it('publishes one project_updated per board joined, carrying the post-claim list item', async () => {
      const first = await createProject('inv publish a');
      const second = await createProject('inv publish b');
      await insertTask({
        projectId: first.project.id,
        columnId: first.columns.find((column) => !column.is_done)!.id,
      });
      await invite(first.project.id, member.email, 'viewer');
      const address = uniqueEmail('inv-publish');
      await invite(first.project.id, address);
      await invite(second.project.id, address, 'viewer');

      let account!: { id: string; token: string };
      const entries = await collectBusEntries(async () => {
        account = await signUp(address);
      });

      const updates = entries.filter((entry) => entry.type === 'project_updated');
      expect(updates.map((entry) => entry.project_id).sort()).toEqual(
        [first.project.id, second.project.id].sort()
      );
      for (const update of updates) {
        expect(update.broadcast).toBe(true);
        expect(update.recipientUserIds).toBeUndefined();
      }

      const byId = new Map(updates.map((entry) => [entry.project_id, entry.data]));
      // Oldest member first: the order is part of the payload, not incidental.
      expect(byId.get(first.project.id)).toMatchObject({
        id: first.project.id,
        member_ids: [member.id, account.id],
        members: [
          { user_id: member.id, role: 'viewer' },
          { user_id: account.id, role: 'editor' },
        ],
        open_task_count: 1,
        done_task_count: 0,
      });
      expect(byId.get(second.project.id)).toMatchObject({
        id: second.project.id,
        members: [{ user_id: account.id, role: 'viewer' }],
        open_task_count: 0,
        done_task_count: 0,
      });
    });

    it('publishes nothing for a board the claimer already had access to', async () => {
      const board = await createProject('inv publish held');
      const address = uniqueEmail('inv-publish-held');
      await invite(board.project.id, address, 'viewer');
      const token = inviteTokenFrom(invitationMailTo(address).text);
      await invite(board.project.id, member.email, 'editor');

      const entries = await collectBusEntries(async () => {
        const res = await ctx.request(member.token).post('/api/invitations/accept', { token });
        expect(res.status).toBe(200);
      });

      expect(entries.filter((entry) => entry.type === 'project_updated')).toEqual([]);
    });

    it('skips an invitation whose project vanished under the claim instead of failing', async () => {
      const board = await createProject('inv vanished');
      const address = uniqueEmail('inv-vanished');
      const body = await invite(board.project.id, address);
      const claimer = await ctx.createUser('inv-vanished-claimer');

      // The read that hands rows to the claim runs before the project is
      // re-read, so a delete landing between them presents exactly this.
      const claimed = await claimInvitations({ get: () => [] } as never, db, claimer.id, [
        { id: body.invitation!.id, project_id: newId(), role: 'editor' },
      ]);

      expect(claimed).toEqual([]);
      expect(await invitationRows(board.project.id)).toHaveLength(1);
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

    it('loses to a revoke that is already holding the row, granting nothing', async () => {
      const board = await createProject('inv signup revoke race');
      const address = uniqueEmail('inv-signup-race');
      const body = await invite(board.project.id, address);

      let deleted!: () => void;
      const deleteIssued = new Promise<void>((resolve) => {
        deleted = resolve;
      });
      let commit!: () => void;
      const released = new Promise<void>((resolve) => {
        commit = resolve;
      });
      // The revoke's delete is issued and left uncommitted, so it owns the row
      // for as long as this transaction is open. Signup then has to meet it
      // mid-claim rather than be raced against it.
      const revoke = db.transaction().execute(async (trx) => {
        await trx.deleteFrom('project_invitation').where('id', '=', body.invitation!.id).execute();
        deleted();
        await released;
      });
      await Promise.race([deleteIssued, revoke]);

      const signup = signUp(address);
      try {
        await waitForLockWaiters(1);
      } finally {
        commit();
      }
      await revoke;
      const account = await signup;

      expect(await roleOf(board.project.id, account.id)).toBeUndefined();
      expect(
        (await ctx.request(account.token).get(`/api/projects/${board.project.id}`)).status
      ).toBe(404);
      expect(await invitationRows(board.project.id)).toEqual([]);
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
      expect(await invitationRows(board.project.id)).toHaveLength(1);
    });

    it('leaves the link alive when the board’s owner redeems it, and stores them nothing', async () => {
      const board = await createProject('inv accept owner');
      const address = uniqueEmail('inv-accept-owner');
      await invite(board.project.id, address, 'viewer');
      const token = inviteTokenFrom(invitationMailTo(address).text);

      const res = await ctx.request(owner.token).post('/api/invitations/accept', { token });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ project_id: board.project.id, role: 'editor' });
      expect(await roleOf(board.project.id, owner.id)).toBeUndefined();
      expect(await invitationRows(board.project.id)).toHaveLength(1);

      // The invitee is the point: the owner checking the link must not spend it.
      const invitee = await signUp(address);
      expect(await roleOf(board.project.id, invitee.id)).toBe('viewer');
      expect(await invitationRows(board.project.id)).toEqual([]);
    });

    it('loses to a demotion revoking the link mid-accept, rather than jamming against it', async () => {
      const board = await createProject('inv accept vs demote');
      expect(
        (
          await ctx
            .request(owner.token)
            .put(`/api/projects/${board.project.id}/members`, { user_ids: [member.id] })
        ).status
      ).toBe(204);
      const address = uniqueEmail('inv-accept-demote');
      await invite(board.project.id, address, undefined, member);
      const token = inviteTokenFrom(invitationMailTo(address).text);

      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let proceed!: () => void;
      const revoking = new Promise<void>((resolve) => {
        proceed = resolve;
      });
      // A member set being replaced, held open between the two statements a
      // real one issues in this order: claim the board, then drop the
      // invitations of everyone it just left without write access.
      const demotion = db.transaction().execute(async (trx) => {
        await trx
          .selectFrom('project')
          .select('id')
          .where('id', '=', board.project.id)
          .forUpdate()
          .executeTakeFirst();
        locked();
        await revoking;
        await trx
          .deleteFrom('project_invitation')
          .where('project_id', '=', board.project.id)
          .where('invited_by', 'not in', [owner.id])
          .execute();
      });
      await lockTaken;

      const accept = ctx.request(outsider.token).post('/api/invitations/accept', { token });
      try {
        await waitForLockWaiters(1);
      } finally {
        proceed();
      }
      await demotion;

      const res = await accept;
      expect(res.status).toBe(422);
      expect(await roleOf(board.project.id, outsider.id)).toBeUndefined();
      expect(await invitationRows(board.project.id)).toEqual([]);
    });

    it('reports the role it actually stored when a membership write lands mid-claim', async () => {
      const board = await createProject('inv accept vs member write');
      const address = uniqueEmail('inv-accept-member-write');
      await invite(board.project.id, address, 'editor');
      const token = inviteTokenFrom(invitationMailTo(address).text);

      let inserted!: () => void;
      const insertIssued = new Promise<void>((resolve) => {
        inserted = resolve;
      });
      let commit!: () => void;
      const released = new Promise<void>((resolve) => {
        commit = resolve;
      });
      // Seats the redeemer as a viewer and holds it uncommitted, so the claim
      // cannot see it in a read yet still meets it at the insert.
      const seating = db.transaction().execute(async (trx) => {
        await trx
          .insertInto('project_member')
          .values({ project_id: board.project.id, user_id: outsider.id, role: 'viewer' })
          .execute();
        inserted();
        await released;
      });
      await Promise.race([insertIssued, seating]);

      const accept = ctx.request(outsider.token).post('/api/invitations/accept', { token });
      try {
        await waitForLockWaiters(1);
      } finally {
        commit();
      }
      await seating;

      const res = await accept;
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ project_id: board.project.id, role: 'viewer' });
      expect(await roleOf(board.project.id, outsider.id)).toBe('viewer');
      // The editor grant never landed, so the link is still the invitee's.
      expect(await invitationRows(board.project.id)).toHaveLength(1);
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

    it('a resend reissues a link that a rotated signing secret orphaned', async () => {
      const board = await createProject('inv rotate');
      const address = uniqueEmail('inv-rotate');
      const body = await invite(board.project.id, address);

      process.env.EMAIL_TOKEN_SECRET = 'rotated-invitation-signing-secret';
      try {
        const orphaned = await ctx
          .request(outsider.token)
          .post('/api/invitations/accept', { token: invitationToken(body.invitation!.id) });
        expect(orphaned.status).toBe(422);

        clearSentEmails();
        expect(
          (
            await ctx
              .request(owner.token)
              .post(`/api/projects/${board.project.id}/invitations/${body.invitation!.id}/resend`)
          ).status
        ).toBe(204);

        const token = inviteTokenFrom(invitationMailTo(address).text);
        expect(
          (await ctx.request(outsider.token).post('/api/invitations/accept', { token })).status
        ).toBe(200);
      } finally {
        delete process.env.EMAIL_TOKEN_SECRET;
      }
    });

    it('a re-invite reissues a link that a rotated signing secret orphaned', async () => {
      const board = await createProject('inv rotate reinvite');
      const address = uniqueEmail('inv-rotate-reinvite');
      const first = await invite(board.project.id, address);

      process.env.EMAIL_TOKEN_SECRET = 'rotated-invitation-signing-secret';
      try {
        expect(
          (
            await ctx
              .request(outsider.token)
              .post('/api/invitations/accept', { token: invitationToken(first.invitation!.id) })
          ).status
        ).toBe(422);

        clearSentEmails();
        const again = await invite(board.project.id, address);
        expect(again.invitation!.id).toBe(first.invitation!.id);

        const token = inviteTokenFrom(invitationMailTo(address).text);
        expect(
          (await ctx.request(outsider.token).post('/api/invitations/accept', { token })).status
        ).toBe(200);
        expect(await roleOf(board.project.id, outsider.id)).toBe('editor');
      } finally {
        delete process.env.EMAIL_TOKEN_SECRET;
      }
    });

    it('drops a pending invitation once its address turns out to have an account', async () => {
      const board = await createProject('inv supersede');
      const address = uniqueEmail('inv-supersede');
      await invite(board.project.id, address);
      const token = inviteTokenFrom(invitationMailTo(address).text);

      const mover = await ctx.createUser('inv-supersede-mover');
      expect(
        (await ctx.request(mover.token).patch('/api/auth/me', { email: address })).status
      ).toBe(200);

      const again = await invite(board.project.id, address);
      expect(again.status).toBe('member');
      expect(await invitationRows(board.project.id)).toEqual([]);
      expect(
        (await ctx.request(outsider.token).post('/api/invitations/accept', { token })).status
      ).toBe(422);
    });

    it('revokes the invitations of an editor who is demoted, keeping the rest', async () => {
      const board = await createProject('inv demote');
      await invite(board.project.id, member.email, 'editor');

      const theirs = uniqueEmail('inv-demote-theirs');
      const fromMember = await invite(board.project.id, theirs, undefined, member);
      const token = inviteTokenFrom(invitationMailTo(theirs).text);
      const ours = uniqueEmail('inv-demote-ours');
      await invite(board.project.id, ours);

      expect(
        (
          await ctx.request(owner.token).put(`/api/projects/${board.project.id}/members`, {
            user_ids: [member.id],
            roles: [{ user_id: member.id, role: 'viewer' }],
          })
        ).status
      ).toBe(204);

      const rows = await invitationRows(board.project.id);
      expect(rows.map((row) => row.email)).toEqual([ours]);
      expect(rows.map((row) => row.id)).not.toContain(fromMember.invitation!.id);
      expect(
        (await ctx.request(outsider.token).post('/api/invitations/accept', { token })).status
      ).toBe(422);
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

    it('answers 429 past the hourly mail budget, having mailed exactly the budget', async () => {
      const board = await createProject('inv budget');

      for (let i = 0; i < INVITE_SEND_MAX_ATTEMPTS; i++) {
        const res = await ctx
          .request(owner.token)
          .post(`/api/projects/${board.project.id}/members/by-email`, {
            email: uniqueEmail(`inv-budget-${i}`),
          });
        expect(res.status).toBe(200);
      }
      expect(sentEmails()).toHaveLength(INVITE_SEND_MAX_ATTEMPTS);

      const throttled = await ctx
        .request(owner.token)
        .post(`/api/projects/${board.project.id}/members/by-email`, {
          email: uniqueEmail('inv-budget-over'),
        });
      expect(throttled.status).toBe(429);
      expect(sentEmails()).toHaveLength(INVITE_SEND_MAX_ATTEMPTS);
      expect(await invitationRows(board.project.id)).toHaveLength(INVITE_SEND_MAX_ATTEMPTS);
    });

    it('lets an editor add far more existing accounts than the mail budget allows', async () => {
      const board = await createProject('inv onboarding');
      const path = `/api/projects/${board.project.id}/members/by-email`;
      const accounts = [member, viewer, outsider];

      for (let i = 0; i <= INVITE_SEND_MAX_ATTEMPTS; i++) {
        const res = await ctx
          .request(owner.token)
          .post(path, { email: accounts[i % accounts.length].email });
        expect(res.status).toBe(200);
        expect(((await res.json()) as ByEmailBody).status).toBe('member');
      }

      expect(sentEmails()).toEqual([]);
      const address = uniqueEmail('inv-onboarding-new');
      expect((await ctx.request(owner.token).post(path, { email: address })).status).toBe(200);
      expect(invitationMailTo(address).to).toBe(address);
    });

    it('charges every address looked up, so 429 answers nothing about one', async () => {
      const board = await createProject('inv oracle');
      const path = `/api/projects/${board.project.id}/members/by-email`;

      for (let i = 0; i < INVITE_LOOKUP_MAX_ATTEMPTS; i++) {
        expect((await ctx.request(owner.token).post(path, { email: member.email })).status).toBe(
          200
        );
      }

      const known = await ctx.request(owner.token).post(path, { email: viewer.email });
      const unknown = await ctx
        .request(owner.token)
        .post(path, { email: uniqueEmail('inv-probe') });
      expect(known.status).toBe(429);
      expect(unknown.status).toBe(429);
      expect(await known.json()).toEqual(await unknown.json());
      expect(await roleOf(board.project.id, viewer.id)).toBeUndefined();
      expect(sentEmails()).toEqual([]);
    });

    it('answers 429 past the per-invitation budget when by-email re-mails the same link', async () => {
      const board = await createProject('inv reinvite budget');
      const address = uniqueEmail('inv-reinvite-budget');
      const path = `/api/projects/${board.project.id}/members/by-email`;

      // One create, then the whole per-invitation budget spent on re-mails.
      for (let i = 0; i <= INVITE_RESEND_MAX_ATTEMPTS; i++) {
        expect((await ctx.request(owner.token).post(path, { email: address })).status).toBe(200);
      }
      expect((await ctx.request(owner.token).post(path, { email: address })).status).toBe(429);
      expect(sentEmails().filter((message) => message.to === address)).toHaveLength(
        INVITE_RESEND_MAX_ATTEMPTS + 1
      );
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
