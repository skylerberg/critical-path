import crypto from 'crypto';
import type { Kysely, Selectable } from 'kysely';
import { APP_NAME } from '../config/constants';
import { env } from '../config/env';
import type { DB, ProjectInvitation } from '../db/types';
import { getEmailSender } from './email/index';
import { normalizeProjectRole, type ProjectRole } from './authorization';
import { inProjectLockOrder } from './projectLock';
import {
  PROJECT_COLUMNS,
  publishProjectListItems,
  type ProjectMemberEntry,
} from './projectListItem';
import { INVITATIONS_CHANGED, publishAfterCommit } from './realtime/index';
import { hashBearerToken } from './sessions';
import type { PublicContext } from '../types/index';
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

// Derived from the row id rather than stored, so a resend can reproduce the link
// already mailed without the raw secret ever being persisted. Validity still
// depends on the row existing, which is what makes revocation and expiry work.
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

// The only publisher of this event, so no caller can decide what rides in it: it
// names the project and nothing more, and readers allowed to know an address can
// refetch the list. Broadcast because the panel showing that list also opens
// from the project list, where an editor is sitting in no board's room.
export function publishInvitationsChanged(c: Pick<PublicContext, 'get'>, projectId: string): void {
  publishAfterCommit(
    c,
    INVITATIONS_CHANGED,
    projectId,
    { project_id: projectId },
    { editorsOnly: true, broadcast: true }
  );
}

export function enqueueInvitationEmail(
  c: Pick<PublicContext, 'get'>,
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
  c: Pick<PublicContext, 'get'>,
  db: Kysely<DB>,
  userId: string,
  rows: Pick<InvitationRow, 'id' | 'project_id' | 'role'>[]
): Promise<ClaimedInvitation[]> {
  if (rows.length === 0) {
    return [];
  }

  const projectIds = rows.map((row) => row.project_id);
  // Every writer that touches an invitation takes the project row first;
  // claiming in the other order closes a deadlock cycle against one revoking
  // invitations under that lock.
  const projects = await db
    .selectFrom('project')
    .select(PROJECT_COLUMNS)
    .where('id', 'in', projectIds)
    .$call(inProjectLockOrder)
    .execute();
  const projectById = new Map(projects.map((project) => [project.id, project]));

  // Locked rather than read: deleting an account cascades these rows away
  // holding only the boards that account created, so the boards taken above
  // cannot keep the role below from being one on its way out. A share lock is
  // the weakest that conflicts with the cascade.
  const held = await db
    .selectFrom('project_member')
    .select(['project_id', 'role'])
    .where('user_id', '=', userId)
    .where('project_id', 'in', projectIds)
    .forShare()
    .execute();
  const heldRole = new Map(held.map((row) => [row.project_id, normalizeProjectRole(row.role)]));

  // Someone who already has access takes nothing from the link, so it stays
  // alive for whoever it was addressed to.
  const grantable = rows.filter((row) => {
    const project = projectById.get(row.project_id);
    return project !== undefined && project.created_by !== userId && !heldRole.has(row.project_id);
  });

  // Consumed before it is honoured, and only rows this statement removed are: a
  // revoke already holding the row wins rather than being overtaken by a grant
  // that read the row before it was withdrawn.
  const consumed =
    grantable.length === 0
      ? []
      : await db
          .deleteFrom('project_invitation')
          .where(
            'id',
            'in',
            grantable.map((row) => row.id)
          )
          .returning('id')
          .execute();
  const consumedIds = new Set(consumed.map((row) => row.id));
  const granted = grantable.filter((row) => consumedIds.has(row.id));

  if (granted.length > 0) {
    await db
      .insertInto('project_member')
      .values(
        granted.map((row) => ({
          project_id: row.project_id,
          user_id: userId,
          role: normalizeProjectRole(row.role),
        }))
      )
      .onConflict((oc) => oc.columns(['project_id', 'user_id']).doNothing())
      .execute();
  }

  await publishProjectListItems(
    c,
    db,
    granted.flatMap((row) => projectById.get(row.project_id) ?? [])
  );
  for (const projectId of new Set(granted.map((row) => row.project_id))) {
    publishInvitationsChanged(c, projectId);
  }

  const grantedRole = new Map(
    granted.map((row) => [row.project_id, normalizeProjectRole(row.role)])
  );
  const claimed: ClaimedInvitation[] = [];
  for (const row of rows) {
    const project = projectById.get(row.project_id);
    if (!project) continue;
    const role =
      project.created_by === userId
        ? 'editor'
        : (heldRole.get(row.project_id) ?? grantedRole.get(row.project_id));
    if (role === undefined) continue;
    claimed.push({ project_id: project.id, role });
  }
  return claimed;
}

// Deliberately not reachable from an address change: otherwise an invitation
// would be a standing grant that fires months later when someone edits their
// address to a previously invited one.
export async function claimInvitationsForNewAccount(
  c: Pick<PublicContext, 'get'>,
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

// Write access is what makes an invitation an editor-grant, so losing it has to
// take the outstanding grants along rather than let them land days later.
export async function revokeInvitationsFromNonEditors(
  c: Pick<PublicContext, 'get'>,
  db: Kysely<DB>,
  projectId: string,
  createdBy: string,
  members: ProjectMemberEntry[]
): Promise<void> {
  const editorIds = [
    createdBy,
    ...members.filter((member) => member.role === 'editor').map((member) => member.user_id),
  ];
  const deleted = await db
    .deleteFrom('project_invitation')
    .where('project_id', '=', projectId)
    .where('invited_by', 'not in', editorIds)
    .executeTakeFirst();
  if (deleted.numDeletedRows > 0n) {
    publishInvitationsChanged(c, projectId);
  }
}
