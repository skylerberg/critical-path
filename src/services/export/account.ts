import type { Kysely } from 'kysely';
import type { DB } from '../../db/types';
import type { AccountExport } from '../../schemas/index';
import { avatarUrl } from '../avatars';
import { normalizeProjectRole } from '../authorization';

const ACCOUNT_EXPORT_FORMAT = 'critical-path-account-export';
const ACCOUNT_EXPORT_VERSION = 1;

// No user text: a display name may itself be an email address, and this value
// lands in a logged response header as well as on the caller's disk.
export function accountExportFilename(now: Date): string {
  return `critical-path-account-${now.toISOString().slice(0, 10)}.json`;
}

export async function buildAccountExport(
  db: Kysely<DB>,
  userId: string,
  now: Date
): Promise<AccountExport> {
  const [account, sessions, tokens, feedback, projects] = await Promise.all([
    db
      .selectFrom('app_user')
      .select([
        'id',
        'name',
        'email',
        'avatar_storage_key',
        'created_at',
        'email_verified_at',
        'notify_task_assigned',
        'notify_added_to_project',
        'notify_bulk_task_assigned',
      ])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow(),
    // Every row, expired ones included: nothing prunes them, so an expiry filter
    // would report a smaller set than is actually held.
    db
      .selectFrom('session')
      .select(['id', 'user_agent', 'created_at', 'expires_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .execute(),
    db
      .selectFrom('personal_access_token')
      .select(['id', 'name', 'created_at', 'expires_at', 'last_used_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .execute(),
    db
      .selectFrom('feedback')
      .select(['id', 'message', 'page_path', 'created_at'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .execute(),
    db
      .selectFrom('project')
      .leftJoin('project_member', (join) =>
        join
          .onRef('project_member.project_id', '=', 'project.id')
          .on('project_member.user_id', '=', userId)
      )
      .select([
        'project.id',
        'project.name',
        'project.created_by',
        'project.created_at',
        'project_member.role',
        'project_member.created_at as member_created_at',
      ])
      .where((eb) =>
        eb.or([eb('project.created_by', '=', userId), eb('project_member.user_id', '=', userId)])
      )
      .orderBy('project.name')
      .orderBy('project.id')
      .execute(),
  ]);

  return {
    format: ACCOUNT_EXPORT_FORMAT,
    version: ACCOUNT_EXPORT_VERSION,
    exported_at: now.toISOString(),
    account: {
      id: account.id,
      name: account.name,
      email: account.email,
      avatar_url: avatarUrl(account.avatar_storage_key),
      created_at: account.created_at.toISOString(),
      email_verified_at: account.email_verified_at?.toISOString() ?? null,
      notification_settings: {
        task_assigned: account.notify_task_assigned,
        added_to_project: account.notify_added_to_project,
        bulk_task_assigned: account.notify_bulk_task_assigned,
      },
    },
    sessions: sessions.map((row) => ({
      id: row.id,
      user_agent: row.user_agent,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
    })),
    personal_access_tokens: tokens.map((row) => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at.toISOString(),
      expires_at: row.expires_at?.toISOString() ?? null,
      last_used_at: row.last_used_at?.toISOString() ?? null,
    })),
    feedback: feedback.map((row) => ({
      id: row.id,
      message: row.message,
      page_path: row.page_path,
      created_at: row.created_at.toISOString(),
    })),
    projects: projects.map((row) => ({
      id: row.id,
      name: row.name,
      role:
        row.created_by === userId ? ('owner' as const) : normalizeProjectRole(row.role ?? 'viewer'),
      // A creator has no member row; the board's own creation is when they got it.
      joined_at: (row.member_created_at ?? row.created_at).toISOString(),
    })),
  };
}
