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

// The task_assignee arm keeps users who lost access visible while their old
// assignments still exist.
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
