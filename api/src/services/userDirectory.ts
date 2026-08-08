import type { ExpressionBuilder, ExpressionWrapper, Kysely, SqlBool } from 'kysely';
import type { DB } from '../db/types';
import { avatarUrl } from './avatars';

// Who a caller may see, rather than what they may do — the listing half of
// project access. Kept apart from ./authorization so a "may X do Y" assertion
// and a "who shows up in this picker" query are never reached for each other by
// mistake: these answer with rows, never with a 403 or a 404.

// Compared in SQL rather than selected and compared in memory: an address that
// is never fetched cannot be spread into a response by a later refactor.
export function matchesEmailFilter(address: string) {
  return (eb: ExpressionBuilder<DB, 'app_user'>): ExpressionWrapper<DB, 'app_user', SqlBool> =>
    eb(eb.fn<string>('lower', ['app_user.email']), '=', address.toLowerCase());
}

export function sharesProjectFilter(userId: string) {
  return (eb: ExpressionBuilder<DB, 'app_user'>): ExpressionWrapper<DB, 'app_user', SqlBool> =>
    eb.exists(
      eb
        .selectFrom('project')
        .select('project.id')
        .where((pb) =>
          pb.and([
            pb.or([
              pb('project.created_by', '=', userId),
              pb.exists(
                pb
                  .selectFrom('project_member as mine')
                  .select('mine.user_id')
                  .whereRef('mine.project_id', '=', 'project.id')
                  .where('mine.user_id', '=', userId)
              ),
            ]),
            pb.or([
              pb(pb.ref('project.created_by'), '=', pb.ref('app_user.id')),
              pb.exists(
                pb
                  .selectFrom('project_member as theirs')
                  .select('theirs.user_id')
                  .whereRef('theirs.project_id', '=', 'project.id')
                  .whereRef('theirs.user_id', '=', 'app_user.id')
              ),
            ]),
          ])
        )
    );
}

export async function projectSharerIdsAmong(
  db: Kysely<DB>,
  userId: string,
  candidateUserIds: string[]
): Promise<string[]> {
  if (candidateUserIds.length === 0) return [];
  const rows = await db
    .selectFrom('app_user')
    .select('app_user.id')
    .where('app_user.id', 'in', candidateUserIds)
    .where(sharesProjectFilter(userId))
    .execute();
  return rows.map((row) => row.id);
}

// The task_assignee, task_comment and task_activity arms keep users who lost
// access visible while their old assignments, comments and log entries exist.
export async function usersWithProjectAccess(
  db: Kysely<DB>,
  projectId: string,
  emailFilter?: string
): Promise<Array<{ id: string; name: string; avatar_url: string | null }>> {
  const rows = await db
    .selectFrom('app_user')
    .select(['app_user.id', 'app_user.name', 'app_user.avatar_storage_key'])
    .where((eb) =>
      eb.and([
        ...(emailFilter === undefined ? [] : [matchesEmailFilter(emailFilter)(eb)]),
        eb.or([
          eb.exists(
            eb
              .selectFrom('project')
              .select('project.id')
              .where('project.id', '=', projectId)
              .whereRef('project.created_by', '=', 'app_user.id')
          ),
          eb.exists(
            eb
              .selectFrom('project_member')
              .select('project_member.user_id')
              .where('project_member.project_id', '=', projectId)
              .whereRef('project_member.user_id', '=', 'app_user.id')
          ),
          eb.exists(
            eb
              .selectFrom('task_assignee')
              .innerJoin('task', 'task.id', 'task_assignee.task_id')
              .select('task_assignee.user_id')
              .where('task.project_id', '=', projectId)
              .whereRef('task_assignee.user_id', '=', 'app_user.id')
          ),
          eb.exists(
            eb
              .selectFrom('task_comment')
              .innerJoin('task', 'task.id', 'task_comment.task_id')
              .select('task_comment.user_id')
              .where('task.project_id', '=', projectId)
              .whereRef('task_comment.user_id', '=', 'app_user.id')
          ),
          eb.exists(
            eb
              .selectFrom('task_activity')
              .innerJoin('task', 'task.id', 'task_activity.task_id')
              .select('task_activity.actor_user_id')
              .where('task.project_id', '=', projectId)
              .whereRef('task_activity.actor_user_id', '=', 'app_user.id')
          ),
        ]),
      ])
    )
    .orderBy('app_user.name')
    .orderBy('app_user.id')
    .execute();
  return rows.map(({ avatar_storage_key, ...rest }) => ({
    ...rest,
    avatar_url: avatarUrl(avatar_storage_key),
  }));
}
