import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql, type Kysely } from 'kysely';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertProjectAccess, canAccessProject } from '../services/authorization';
import { publishAfterCommit } from '../services/realtime/index';
import { recordTaskActivity } from '../services/taskActivity';
import { getArchivedTasksByIds } from '../services/boardPayload';
import {
  idSchema,
  createColumnSchema,
  patchColumnSchema,
  columnSchema,
  deleteColumnQuerySchema,
  moveColumnTasksSchema,
  movedTasksResponseSchema,
  archivedTasksResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  unprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';
import type { DB } from '../db/types';
import type { ColumnResponse, MovedTask } from '../schemas/index';

const router: AppHono = new Hono();

const COLUMN_COLUMNS = ['id', 'project_id', 'name', 'position', 'is_done', 'created_at'] as const;

function serializeColumn(row: {
  id: string;
  project_id: string;
  name: string;
  position: number;
  is_done: boolean;
  created_at: Date;
}): ColumnResponse {
  return { ...row, created_at: row.created_at.toISOString() };
}

async function loadMoveTarget(
  db: Kysely<DB>,
  targetColumnId: string,
  sourceColumnId: string,
  projectId: string,
  field: string
): Promise<{ id: string; name: string }> {
  if (targetColumnId === sourceColumnId) {
    throw new AppError(422, `${field} must not be the source column`);
  }
  const target = await db
    .selectFrom('board_column')
    .select(['id', 'project_id', 'name'])
    .where('id', '=', targetColumnId)
    .executeTakeFirst();
  if (!target) {
    throw new AppError(422, `${field} column does not exist`);
  }
  if (target.project_id !== projectId) {
    throw new AppError(422, `${field} column belongs to another project`);
  }
  return { id: target.id, name: target.name };
}

async function relocateTasks(
  db: Kysely<DB>,
  actorUserId: string,
  taskIds: readonly string[],
  source: { id: string; name: string },
  target: { id: string; name: string }
): Promise<MovedTask[]> {
  if (taskIds.length === 0) {
    return [];
  }

  // Spans archived rows too, so a relocated task never collides with one.
  const { max } = await db
    .selectFrom('task')
    .select((eb) => eb.fn.max<number | null>('position').as('max'))
    .where('column_id', '=', target.id)
    .executeTakeFirstOrThrow();
  const base = max ?? 0;

  const movedTasks = taskIds.map((taskId, index) => ({
    id: taskId,
    column_id: target.id,
    position: base + (index + 1) * 1000,
  }));

  await sql`
    update task
    set column_id = ${target.id}::uuid, position = v.position
    from (values ${sql.join(
      movedTasks.map((task) => sql`(${task.id}::uuid, ${task.position}::float8)`)
    )}) as v(id, position)
    where task.id = v.id
  `.execute(db);

  await recordTaskActivity(
    db,
    actorUserId,
    movedTasks.map((task) => ({
      taskId: task.id,
      kind: 'column_changed' as const,
      oldValue: { id: source.id, name: source.name },
      newValue: { id: target.id, name: target.name },
    }))
  );

  return movedTasks;
}

router.post(
  '/',
  describeRoute({
    tags: ['Columns'],
    summary: 'Create column',
    description:
      'Create a board column in a project. The client supplies the column id. ' +
      'Returns 404 when the referenced project is unknown or inaccessible and 409 on a duplicate id.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Column created',
        content: {
          'application/json': {
            schema: resolver(columnSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(createColumnSchema),
  async (c) => {
    const { id, project_id, name, position, is_done } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await db
      .selectFrom('project')
      .select(['id', 'created_by'])
      .where('id', '=', project_id)
      .executeTakeFirst();
    if (!project || !(await canAccessProject(db, user.id, project))) {
      throw new AppError(404, 'Project not found');
    }

    try {
      const column = await db
        .insertInto('board_column')
        .values({ id, project_id, name, position, is_done: is_done ?? false })
        .returning(COLUMN_COLUMNS)
        .executeTakeFirstOrThrow();
      publishAfterCommit(c, 'column_created', project_id, serializeColumn(column));
      return c.json(serializeColumn(column), 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Column id already exists');
      }
      throw err;
    }
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Columns'],
    summary: 'Update column',
    description: 'Update the name, position, or done flag of a column.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated column',
        content: {
          'application/json': {
            schema: resolver(columnSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(patchColumnSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { name, position, is_done } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const existing = await db
      .selectFrom('board_column')
      .select(COLUMN_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) {
      throw new AppError(404, 'Column not found');
    }
    await assertProjectAccess(db, user.id, existing.project_id, 'Column not found');

    const updates: Partial<{ name: string; position: number; is_done: boolean }> = {};
    if (name !== undefined) updates.name = name;
    if (position !== undefined) updates.position = position;
    if (is_done !== undefined) updates.is_done = is_done;

    const column =
      Object.keys(updates).length === 0
        ? existing
        : await db
            .updateTable('board_column')
            .set(updates)
            .where('id', '=', id)
            .returning(COLUMN_COLUMNS)
            .executeTakeFirst();

    if (!column) {
      throw new AppError(404, 'Column not found');
    }

    publishAfterCommit(c, 'column_updated', column.project_id, serializeColumn(column));
    return c.json(serializeColumn(column), 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Columns'],
    summary: 'Delete column',
    description:
      'Delete a column. An empty column returns 204. A column with tasks requires a ' +
      '`move_tasks_to` query parameter naming another column in the same project; its tasks are ' +
      'appended after the target column’s existing tasks (keeping relative order) and the ' +
      'response is 200 with the moved tasks’ new positions. Returns 409 when the column has ' +
      'tasks and no target is given, and 422 when `move_tasks_to` does not exist, belongs to ' +
      'another project, or equals the deleted column. Archived tasks count as tasks here, so a ' +
      'column that looks empty in the board payload can still require `move_tasks_to`, and ' +
      '`moved_tasks` can name tasks that payload never served.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description:
          'Column deleted; its tasks, archived ones included, were moved to the target column',
        content: {
          'application/json': {
            schema: resolver(movedTasksResponseSchema),
          },
        },
      },
      204: {
        description: 'Empty column deleted',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...unprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  queryValidator(deleteColumnQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { move_tasks_to } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    const column = await db
      .selectFrom('board_column')
      .select(['id', 'project_id', 'name'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!column) {
      throw new AppError(404, 'Column not found');
    }
    await assertProjectAccess(db, user.id, column.project_id, 'Column not found');

    const target =
      move_tasks_to === undefined
        ? undefined
        : await loadMoveTarget(db, move_tasks_to, id, column.project_id, 'move_tasks_to');

    const tasks = await db
      .selectFrom('task')
      .select('id')
      .where('column_id', '=', id)
      .orderBy('position')
      .orderBy('id')
      .execute();

    if (tasks.length > 0) {
      if (target === undefined) {
        throw new AppError(409, 'Column has tasks; provide move_tasks_to');
      }

      const movedTasks = await relocateTasks(
        db,
        user.id,
        tasks.map((task) => task.id),
        column,
        target
      );

      await db.deleteFrom('board_column').where('id', '=', id).execute();

      publishAfterCommit(c, 'column_deleted', column.project_id, { id, moved_tasks: movedTasks });
      return c.json({ moved_tasks: movedTasks }, 200);
    }

    await db.deleteFrom('board_column').where('id', '=', id).execute();

    publishAfterCommit(c, 'column_deleted', column.project_id, { id, moved_tasks: [] });
    return c.body(null, 204);
  }
);

router.post(
  '/:id/move-tasks',
  describeRoute({
    tags: ['Columns'],
    summary: 'Move all tasks to another column',
    description:
      'Move every live task in a column to another column in the same project, appended after ' +
      'the target column’s existing tasks and keeping their relative order. The source column ' +
      'is kept; an empty source column is a 200 with an empty `moved_tasks`. Archived tasks ' +
      'stay where they are, so restoring one later returns it to the column it was archived ' +
      'from. Returns 422 when `target_column_id` does not exist, belongs to another project, ' +
      'or equals the source column.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Moved tasks with their new positions',
        content: {
          'application/json': {
            schema: resolver(movedTasksResponseSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(moveColumnTasksSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { target_column_id } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const column = await db
      .selectFrom('board_column')
      .select(['id', 'project_id', 'name'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!column) {
      throw new AppError(404, 'Column not found');
    }
    await assertProjectAccess(db, user.id, column.project_id, 'Column not found');

    const target = await loadMoveTarget(
      db,
      target_column_id,
      id,
      column.project_id,
      'target_column_id'
    );

    const tasks = await db
      .selectFrom('task')
      .select('id')
      .where('column_id', '=', id)
      .where('archived_at', 'is', null)
      .orderBy('position')
      .orderBy('id')
      .execute();

    const movedTasks = await relocateTasks(
      db,
      user.id,
      tasks.map((task) => task.id),
      column,
      target
    );

    if (movedTasks.length > 0) {
      publishAfterCommit(c, 'column_tasks_moved', column.project_id, {
        column_id: id,
        target_column_id: target.id,
        moved_tasks: movedTasks,
      });
    }
    return c.json({ moved_tasks: movedTasks }, 200);
  }
);

router.post(
  '/:id/archive-tasks',
  describeRoute({
    tags: ['Columns'],
    summary: 'Archive all tasks in a column',
    description:
      'Archive every live task in a column in one call: a soft delete that keeps the rows and ' +
      'their dependency edges but takes the tasks out of the board payload, out of every ' +
      'blocker and dependent list, and out of the project task counts. Already archived tasks ' +
      'keep their original archived_at and are absent from the response, so repeating the ' +
      'call is a no-op 200. The column itself is kept.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Newly archived tasks in board-payload shape plus archived_at',
        content: {
          'application/json': {
            schema: resolver(archivedTasksResponseSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const column = await db
      .selectFrom('board_column')
      .select(['id', 'project_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!column) {
      throw new AppError(404, 'Column not found');
    }
    await assertProjectAccess(db, user.id, column.project_id, 'Column not found');

    const archived = await db
      .updateTable('task')
      .set({ archived_at: sql<Date>`now()` })
      .where('column_id', '=', id)
      .where('archived_at', 'is', null)
      .returning('id')
      .execute();

    if (archived.length === 0) {
      return c.json({ tasks: [] }, 200);
    }

    const taskIds = archived.map((row) => row.id);
    await recordTaskActivity(
      db,
      user.id,
      taskIds.map((taskId) => ({ taskId, kind: 'archived' as const }))
    );

    const tasks = await getArchivedTasksByIds(db, column.project_id, taskIds);
    publishAfterCommit(c, 'column_tasks_archived', column.project_id, { column_id: id, tasks });
    return c.json({ tasks }, 200);
  }
);

export default router;
