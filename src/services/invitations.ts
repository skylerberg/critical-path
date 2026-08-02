import crypto from 'crypto';
import type { Kysely, Selectable } from 'kysely';
import { APP_NAME } from '../config/constants';
import { env } from '../config/env';
import type { DB, ProjectInvitation } from '../db/types';
import { getEmailSender } from './email/index';
import { normalizeProjectRole, type ProjectRole } from './authorization';
import { PROJECT_COLUMNS, fetchMembers, publishProjectListItem } from './projectListItem';
import { hashBearerToken } from './sessions';
import type { AppContext } from '../types/index';
import type { ProjectInvitationResponse } from '../schemas/projects';

export const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_INVITATIONS_PER_PROJECT = 100;

export type InvitationRow = Selectable<ProjectInvitation>;

export const INVITATION_COLUMNS = [
  'id',
  'project_id',
  'email',
  'role',
  'invited_by',
  'created_at',
  'expires_at',
] as const;

// Derived from the row id rather than stored, so a resend can reproduce the
// link that was already mailed without the raw secret ever being persisted.
// Validity still depends on the row existing, which is what makes revocation
// and expiry work at all.
export function invitationToken(invitationId: string): string {
  return crypto
    .createHmac('sha256', env.emailTokenSecret)
    .update(`invitation:${invitationId}`)
    .digest('base64url');
}

export function invitationTokenHash(invitationId: string): string {
  return hashBearerToken(invitationToken(invitationId));
}

export function invitationExpiry(now = Date.now()): Date {
  return new Date(now + INVITATION_TTL_MS);
}

export function toInvitationResponse(
  row: Pick<InvitationRow, (typeof INVITATION_COLUMNS)[number]>
): ProjectInvitationResponse {
  return {
    id: row.id,
    project_id: row.project_id,
    email: row.email,
    role: normalizeProjectRole(row.role),
    invited_by: row.invited_by,
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
  };
}

export function enqueueInvitationEmail(
  c: Pick<AppContext, 'get'>,
  invitation: { id: string; email: string },
  projectName: string,
  inviterName: string
): void {
  const link = `${env.appUrlBase}/invite?token=${encodeURIComponent(invitationToken(invitation.id))}`;
  const to = invitation.email;

  c.get('postCommitHooks').push(() =>
    getEmailSender().send({
      to,
      subject: `${inviterName} invited you to "${projectName}" on ${APP_NAME}`,
      text:
        `${inviterName} invited you to the board "${projectName}" on ${APP_NAME}.\n\n` +
        `Accept the invitation here (the link expires in 14 days): ${link}\n\n` +
        'You will be asked to sign in or create an account first. If you were not ' +
        'expecting this, you can ignore this email.',
    })
  );
}

export interface ClaimedInvitation {
  project_id: string;
  role: ProjectRole;
}

// Never demotes: a viewer invitation must not take an existing editor's rights
// away.
export async function claimInvitations(
  c: Pick<AppContext, 'get'>,
  db: Kysely<DB>,
  userId: string,
  rows: Pick<InvitationRow, 'id' | 'project_id' | 'role'>[]
): Promise<ClaimedInvitation[]> {
  if (rows.length === 0) {
    return [];
  }

  const projects = await db
    .selectFrom('project')
    .select(PROJECT_COLUMNS)
    .where(
      'id',
      'in',
      rows.map((row) => row.project_id)
    )
    .execute();
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const joined = rows.filter((row) => projectById.get(row.project_id)?.created_by !== userId);
  if (joined.length > 0) {
    await db
      .insertInto('project_member')
      .values(
        joined.map((row) => ({
          project_id: row.project_id,
          user_id: userId,
          role: normalizeProjectRole(row.role),
        }))
      )
      .onConflict((oc) => oc.columns(['project_id', 'user_id']).doNothing())
      .execute();
  }

  await db
    .deleteFrom('project_invitation')
    .where(
      'id',
      'in',
      rows.map((row) => row.id)
    )
    .execute();

  const claimed: ClaimedInvitation[] = [];
  for (const row of rows) {
    const project = projectById.get(row.project_id);
    if (!project) continue;
    const members = await fetchMembers(db, project.id);
    await publishProjectListItem(c, db, project, members);
    claimed.push({
      project_id: project.id,
      role:
        project.created_by === userId
          ? 'editor'
          : (members.find((member) => member.user_id === userId)?.role ??
            normalizeProjectRole(row.role)),
    });
  }
  return claimed;
}

// Deliberately not reachable from an address change: otherwise an invitation
// would be a standing grant that fires months later when someone edits their
// address to a previously invited one.
export async function claimInvitationsForNewAccount(
  c: Pick<AppContext, 'get'>,
  db: Kysely<DB>,
  userId: string,
  email: string
): Promise<ClaimedInvitation[]> {
  const rows = await db
    .selectFrom('project_invitation')
    .select(['id', 'project_id', 'role'])
    .where('email_lower', '=', email.toLowerCase())
    .where('expires_at', '>', new Date())
    .execute();
  return claimInvitations(c, db, userId, rows);
}
