import type { Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import type { BoardPayload, TiptapDoc } from '../schemas/index';

export async function getBoardPayload(
  db: Kysely<DB>,
  projectId: string
): Promise<BoardPayload | null> {
  const project = await db
    .selectFrom('project')
    .select(['id', 'name', 'description', 'is_template', 'archived_at', 'created_at'])
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

  const tasks = await db
    .selectFrom('task')
    .select((eb) => [
      'task.id',
      'task.column_id',
      'task.title',
      'task.description',
      'task.position',
      'task.created_at',
      'task.updated_at',
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
      jsonArrayFrom(
        eb
          .selectFrom('task_dependency')
          .select('task_dependency.blocker_task_id')
          .whereRef('task_dependency.blocked_task_id', '=', 'task.id')
          .orderBy('task_dependency.blocker_task_id')
      ).as('blocker_rows'),
      eb
        .selectFrom('task_image')
        .select((ib) => ib.fn.countAll<string>().as('image_count'))
        .whereRef('task_image.task_id', '=', 'task.id')
        .as('image_count'),
    ])
    .where('task.project_id', '=', projectId)
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
      is_template: project.is_template,
      archived_at: project.archived_at?.toISOString() ?? null,
      created_at: project.created_at.toISOString(),
    },
    columns,
    tasks: tasks.map((task) => ({
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
    })),
    labels,
  };
}
