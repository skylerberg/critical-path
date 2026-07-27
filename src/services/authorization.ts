import type { ExpressionBuilder, ExpressionWrapper, Kysely, Selectable, SqlBool } from 'kysely';
import type { DB, Project } from '../db/types';
import { AppError } from '../utils/errors';
import { avatarUrl } from './avatars';

export interface ProjectAccessFields {
  id: string;
  created_by: string | null;
}

export async function isProjectMember(
  db: Kysely<DB>,
  projectId: string,
  userId: string
): Promise<boolean> {
  const row = await db
    .selectFrom('project_member')
    .select('user_id')
    .where('project_id', '=', projectId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row !== undefined;
}

export async function canAccessProject(
  db: Kysely<DB>,
  userId: string,
  project: ProjectAccessFields
): Promise<boolean> {
  if (project.created_by === userId) return true;
  return await isProjectMember(db, project.id, userId);
}

// 404 rather than 403 so inaccessible projects are indistinguishable from
// nonexistent ones.
export async function assertProjectAccess(
  db: Kysely<DB>,
  userId: string,
  projectId: string,
  notFoundMessage = 'Project not found'
): Promise<Selectable<Project>> {
  const project = await db
    .selectFrom('project')
    .selectAll()
    .where('id', '=', projectId)
    .executeTakeFirst();
  if (!project || !(await canAccessProject(db, userId, project))) {
    throw new AppError(404, notFoundMessage);
  }
  return project;
}

export function assertProjectOwnedBy(
  project: { created_by: string | null },
  userId: string,
  forbiddenMessage: string
): void {
  if (project.created_by !== userId) {
    throw new AppError(403, forbiddenMessage);
  }
}

// Access is asserted first, so a caller who cannot see the project still gets
// 404 and 403 only ever reaches someone who can already read created_by.
export async function assertProjectOwner(
  db: Kysely<DB>,
  userId: string,
  projectId: string,
  forbiddenMessage: string
): Promise<Selectable<Project>> {
  const project = await assertProjectAccess(db, userId, projectId);
  assertProjectOwnedBy(project, userId, forbiddenMessage);
  return project;
}

// Guards the row the caller is about to serve, so the flag can never be read
// from a different snapshot than the payload it gates.
export function assertPublicProject(project: { is_public: boolean }): void {
  if (!project.is_public) {
    throw new AppError(404, 'This board is not public');
  }
}

export async function assertTaskAccess(
  db: Kysely<DB>,
  userId: string,
  taskId: string
): Promise<Selectable<Project>> {
  const task = await db
    .selectFrom('task')
    .select('task.project_id')
    .where('task.id', '=', taskId)
    .executeTakeFirst();
  if (!task) {
    throw new AppError(404, 'Task not found');
  }
  return await assertProjectAccess(db, userId, task.project_id, 'Task not found');
}

export function accessibleProjectsFilter(userId: string) {
  return (eb: ExpressionBuilder<DB, 'project'>): ExpressionWrapper<DB, 'project', SqlBool> =>
    eb.or([
      eb('project.created_by', '=', userId),
      eb.exists(
        eb
          .selectFrom('project_member')
          .select('project_member.user_id')
          .whereRef('project_member.project_id', '=', 'project.id')
          .where('project_member.user_id', '=', userId)
      ),
    ]);
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

export async function projectAccessIdsAmong(
  db: Kysely<DB>,
  project: ProjectAccessFields,
  candidateUserIds: string[]
): Promise<string[]> {
  if (candidateUserIds.length === 0) return [];
  const rows = await db
    .selectFrom('app_user')
    .select('app_user.id')
    .where('app_user.id', 'in', candidateUserIds)
    .where((eb) =>
      eb.or([
        ...(project.created_by === null ? [] : [eb('app_user.id', '=', project.created_by)]),
        eb.exists(
          eb
            .selectFrom('project_member')
            .select('project_member.user_id')
            .where('project_member.project_id', '=', project.id)
            .whereRef('project_member.user_id', '=', 'app_user.id')
        ),
      ])
    )
    .execute();
  return rows.map((row) => row.id);
}

// The task_assignee, task_comment and task_activity arms keep users who lost
// access visible while their old assignments, comments and log entries exist.
export async function usersWithProjectAccess(
  db: Kysely<DB>,
  projectId: string
): Promise<Array<{ id: string; email: string; name: string; avatar_url: string | null }>> {
  const rows = await db
    .selectFrom('app_user')
    .select(['app_user.id', 'app_user.email', 'app_user.name', 'app_user.avatar_storage_key'])
    .where((eb) =>
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
