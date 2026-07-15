import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql } from 'kysely';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator, queryValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import {
  idSchema,
  createColumnSchema,
  patchColumnSchema,
  columnSchema,
  deleteColumnQuerySchema,
  movedTasksResponseSchema,
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
import type { ColumnResponse } from '../schemas/index';

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

router.post(
  '/',
  describeRoute({
    tags: ['Columns'],
    summary: 'Create column',
    description:
      'Create a board column in a project. The client supplies the column id. ' +
      'Returns 422 when the referenced project does not exist and 409 on a duplicate id.',
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

    const project = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', project_id)
      .executeTakeFirst();
    if (!project) {
      throw new AppError(422, 'Project does not exist');
    }

    try {
      const column = await db
        .insertInto('board_column')
        .values({ id, project_id, name, position, is_done: is_done ?? false })
        .returning(COLUMN_COLUMNS)
        .executeTakeFirstOrThrow();
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

    const updates: Partial<{ name: string; position: number; is_done: boolean }> = {};
    if (name !== undefined) updates.name = name;
    if (position !== undefined) updates.position = position;
    if (is_done !== undefined) updates.is_done = is_done;

    const column =
      Object.keys(updates).length === 0
        ? await db
            .selectFrom('board_column')
            .select(COLUMN_COLUMNS)
            .where('id', '=', id)
            .executeTakeFirst()
        : await db
            .updateTable('board_column')
            .set(updates)
            .where('id', '=', id)
            .returning(COLUMN_COLUMNS)
            .executeTakeFirst();

    if (!column) {
      throw new AppError(404, 'Column not found');
    }

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
      'another project, or equals the deleted column.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Column deleted; its tasks were moved to the target column',
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

    const column = await db
      .selectFrom('board_column')
      .select(['id', 'project_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!column) {
      throw new AppError(404, 'Column not found');
    }

    if (move_tasks_to !== undefined) {
      if (move_tasks_to === id) {
        throw new AppError(422, 'move_tasks_to must not be the column being deleted');
      }
      const target = await db
        .selectFrom('board_column')
        .select(['id', 'project_id'])
        .where('id', '=', move_tasks_to)
        .executeTakeFirst();
      if (!target) {
        throw new AppError(422, 'move_tasks_to column does not exist');
      }
      if (target.project_id !== column.project_id) {
        throw new AppError(422, 'move_tasks_to column belongs to another project');
      }
    }

    const tasks = await db
      .selectFrom('task')
      .select('id')
      .where('column_id', '=', id)
      .orderBy('position')
      .orderBy('id')
      .execute();

    if (tasks.length > 0) {
      if (move_tasks_to === undefined) {
        throw new AppError(409, 'Column has tasks; provide move_tasks_to');
      }

      const { max } = await db
        .selectFrom('task')
        .select((eb) => eb.fn.max<number | null>('position').as('max'))
        .where('column_id', '=', move_tasks_to)
        .executeTakeFirstOrThrow();
      const base = max ?? 0;

      const movedTasks = tasks.map((task, index) => ({
        id: task.id,
        column_id: move_tasks_to,
        position: base + (index + 1) * 1000,
      }));

      await sql`
        update task
        set column_id = ${move_tasks_to}::uuid, position = v.position
        from (values ${sql.join(
          movedTasks.map((task) => sql`(${task.id}::uuid, ${task.position}::float8)`)
        )}) as v(id, position)
        where task.id = v.id
      `.execute(db);

      await db.deleteFrom('board_column').where('id', '=', id).execute();

      return c.json({ moved_tasks: movedTasks }, 200);
    }

    await db.deleteFrom('board_column').where('id', '=', id).execute();

    return c.body(null, 204);
  }
);

export default router;
