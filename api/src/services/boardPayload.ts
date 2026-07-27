import type { Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import type {
  ArchivedTask,
  BoardPayload,
  BoardTask,
  PublicBoard,
  PublicBoardUser,
  TiptapDoc,
} from '../schemas/index';
import { assertPublicProject, usersWithProjectAccess } from './authorization';
import { unarchivedBlockerIds } from './taskRelations';

function projectTasksQuery(db: Kysely<DB>, projectId: string) {
  return db
    .selectFrom('task')
    .select((eb) => [
      'task.id',
      'task.column_id',
      'task.title',
      'task.description',
      'task.position',
      'task.created_at',
      'task.updated_at',
      'task.archived_at',
      jsonArrayFrom(
        eb
          .selectFrom('task_label')
          .select('task_label.label_id')
          .whereRef('task_label.task_id', '=', 'task.id')
          .orderBy('task_label.label_id')
      ).as('label_rows'),
      jsonArrayFrom(
        eb
          .selectFrom('task_assignee')
          .select('task_assignee.user_id')
          .whereRef('task_assignee.task_id', '=', 'task.id')
          .orderBy('task_assignee.user_id')
      ).as('assignee_rows'),
      unarchivedBlockerIds(eb).as('blocker_rows'),
      eb
        .selectFrom('task_image')
        .select((ib) => ib.fn.countAll<string>().as('image_count'))
        .whereRef('task_image.task_id', '=', 'task.id')
        .as('image_count'),
      eb
        .selectFrom('task_comment')
        .select((cb) => cb.fn.countAll<string>().as('comment_count'))
        .whereRef('task_comment.task_id', '=', 'task.id')
        .as('comment_count'),
    ])
    .where('task.project_id', '=', projectId);
}

type ProjectTaskRow = Awaited<ReturnType<ReturnType<typeof projectTasksQuery>['execute']>>[number];

function toBoardTask(task: ProjectTaskRow): BoardTask {
  return {
    id: task.id,
    column_id: task.column_id,
    title: task.title,
    description: task.description as TiptapDoc | null,
    position: task.position,
    created_at: task.created_at.toISOString(),
    updated_at: task.updated_at.toISOString(),
    label_ids: task.label_rows.map((row) => row.label_id),
    assignee_ids: task.assignee_rows.map((row) => row.user_id),
    blocker_ids: task.blocker_rows.map((row) => row.blocker_task_id),
    image_count: Number(task.image_count),
    comment_count: Number(task.comment_count),
  };
}

function toArchivedTask(row: ProjectTaskRow): ArchivedTask {
  return { ...toBoardTask(row), archived_at: (row.archived_at as Date).toISOString() };
}

// A bulk column archive stamps one archived_at across the batch, so position is
// what keeps those rows in board order rather than uuid order.
function archivedTasksQuery(db: Kysely<DB>, projectId: string) {
  return projectTasksQuery(db, projectId)
    .where('task.archived_at', 'is not', null)
    .orderBy('task.archived_at', 'desc')
    .orderBy('task.position')
    .orderBy('task.id');
}

export async function getArchivedTasks(db: Kysely<DB>, projectId: string): Promise<ArchivedTask[]> {
  const rows = await archivedTasksQuery(db, projectId).execute();

  return rows.map(toArchivedTask);
}

export async function getArchivedTasksByIds(
  db: Kysely<DB>,
  projectId: string,
  taskIds: readonly string[]
): Promise<ArchivedTask[]> {
  if (taskIds.length === 0) {
    return [];
  }
  const rows = await archivedTasksQuery(db, projectId)
    .where('task.id', 'in', [...taskIds])
    .execute();

  return rows.map(toArchivedTask);
}

export async function getBoardPayload(
  db: Kysely<DB>,
  projectId: string
): Promise<BoardPayload | null> {
  const project = await db
    .selectFrom('project')
    .select((eb) => [
      'id',
      'name',
      'description',
      'archived_at',
      'created_at',
      'created_by',
      'is_public',
      jsonArrayFrom(
        eb
          .selectFrom('project_member')
          .select('project_member.user_id')
          .whereRef('project_member.project_id', '=', 'project.id')
          .orderBy('project_member.created_at')
          .orderBy('project_member.user_id')
      ).as('member_rows'),
    ])
    .where('id', '=', projectId)
    .executeTakeFirst();

  if (!project) {
    return null;
  }

  const columns = await db
    .selectFrom('board_column')
    .select(['id', 'name', 'position', 'is_done'])
    .where('project_id', '=', projectId)
    .orderBy('position')
    .orderBy('id')
    .execute();

  const tasks = await projectTasksQuery(db, projectId)
    .where('task.archived_at', 'is', null)
    .orderBy('task.position')
    .orderBy('task.id')
    .execute();

  const labels = await db
    .selectFrom('label')
    .select(['id', 'name', 'color'])
    .where('project_id', '=', projectId)
    .orderBy('name')
    .orderBy('id')
    .execute();

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      archived_at: project.archived_at?.toISOString() ?? null,
      created_at: project.created_at.toISOString(),
      created_by: project.created_by,
      member_ids: project.member_rows.map((row) => row.user_id),
      is_public: project.is_public,
    },
    columns,
    tasks: tasks.map(toBoardTask),
    labels,
  };
}

// Never spread: listing every field by hand is what keeps a newly added board
// field private until someone deliberately publishes it here.
export function toPublicBoard(payload: BoardPayload, users: PublicBoardUser[]): PublicBoard {
  return {
    project: {
      id: payload.project.id,
      name: payload.project.name,
      description: payload.project.description,
    },
    columns: payload.columns.map((column) => ({
      id: column.id,
      name: column.name,
      position: column.position,
      is_done: column.is_done,
    })),
    tasks: payload.tasks.map((task) => ({
      id: task.id,
      column_id: task.column_id,
      title: task.title,
      description: task.description,
      position: task.position,
      label_ids: task.label_ids,
      assignee_ids: task.assignee_ids,
      blocker_ids: task.blocker_ids,
      image_count: task.image_count,
    })),
    labels: payload.labels.map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      avatar_url: user.avatar_url,
    })),
  };
}

export async function getPublicBoard(
  db: Kysely<DB>,
  projectId: string
): Promise<PublicBoard | null> {
  const payload = await getBoardPayload(db, projectId);
  if (!payload) {
    return null;
  }
  assertPublicProject(payload.project);

  const assigneeIds = new Set(payload.tasks.flatMap((task) => task.assignee_ids));
  const users =
    assigneeIds.size === 0
      ? []
      : (await usersWithProjectAccess(db, projectId))
          .filter((user) => assigneeIds.has(user.id))
          .map(({ id, name, avatar_url }) => ({ id, name, avatar_url }));

  return toPublicBoard(payload, users);
}
