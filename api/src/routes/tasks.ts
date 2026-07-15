import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql, type Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { storage } from '../services/storage/index';
import { lockProjectDependencies, wouldCreateDependencyCycle } from '../services/dependencies';
import {
  idSchema,
  createTaskSchema,
  patchTaskSchema,
  taskDetailResponseSchema,
  addBlockerSchema,
  setTaskLabelsSchema,
  setTaskAssigneesSchema,
  taskBlockerParamsSchema,
  boardTaskSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
  type TiptapDoc,
  type BoardTask,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

async function fetchBoardTask(
  db: Kysely<DB>,
  taskId: string
): Promise<{ task: BoardTask; project_id: string } | undefined> {
  const row = await db
    .selectFrom('task')
    .select((eb) => [
      'task.id',
      'task.project_id',
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
      ).as('labels'),
      jsonArrayFrom(
        eb
          .selectFrom('task_assignee')
          .select('task_assignee.user_id')
          .whereRef('task_assignee.task_id', '=', 'task.id')
          .orderBy('task_assignee.user_id')
      ).as('assignees'),
      jsonArrayFrom(
        eb
          .selectFrom('task_dependency')
          .select('task_dependency.blocker_task_id')
          .whereRef('task_dependency.blocked_task_id', '=', 'task.id')
          .orderBy('task_dependency.blocker_task_id')
      ).as('blockers'),
      eb
        .selectFrom('task_image')
        .select((ib) => ib.fn.countAll<string>().as('count'))
        .whereRef('task_image.task_id', '=', 'task.id')
        .as('image_count'),
    ])
    .where('task.id', '=', taskId)
    .executeTakeFirst();

  if (!row) {
    return undefined;
  }

  return {
    task: {
      id: row.id,
      column_id: row.column_id,
      title: row.title,
      description: row.description as TiptapDoc | null,
      position: row.position,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      label_ids: row.labels.map((l) => l.label_id),
      assignee_ids: row.assignees.map((a) => a.user_id),
      blocker_ids: row.blockers.map((b) => b.blocker_task_id),
      image_count: Number(row.image_count ?? 0),
    },
    project_id: row.project_id,
  };
}

async function assertColumnInProject(
  db: Kysely<DB>,
  columnId: string,
  projectId: string
): Promise<void> {
  const column = await db
    .selectFrom('board_column')
    .select('board_column.project_id')
    .where('board_column.id', '=', columnId)
    .executeTakeFirst();
  if (!column || column.project_id !== projectId) {
    throw new AppError(422, 'column_id must reference a column in the project');
  }
}

async function assertLabelsInProject(
  db: Kysely<DB>,
  labelIds: string[],
  projectId: string
): Promise<void> {
  if (labelIds.length === 0) {
    return;
  }
  const rows = await db
    .selectFrom('label')
    .select('label.id')
    .where('label.id', 'in', labelIds)
    .where('label.project_id', '=', projectId)
    .execute();
  if (rows.length !== labelIds.length) {
    throw new AppError(422, 'label_ids must reference labels in the project');
  }
}

async function assertUsersExist(db: Kysely<DB>, userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  const rows = await db
    .selectFrom('app_user')
    .select('app_user.id')
    .where('app_user.id', 'in', userIds)
    .execute();
  if (rows.length !== userIds.length) {
    throw new AppError(422, 'assignee user ids must reference existing users');
  }
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}

// The generated Json column type has an index signature the TiptapDoc
// interface cannot satisfy; serializing keeps the write type-safe and jsonb
// parses the text back into the same document.
function serializeDescription(description: TiptapDoc | null | undefined): string | null {
  return description == null ? null : JSON.stringify(description);
}

router.post(
  '/',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Create a task',
    description:
      'Create a task in a column. The client supplies the task id. The column must belong to ' +
      'the project, labels must belong to the project, and assignees must be existing users; ' +
      'violations return 422 with a plain error body.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Created task in board-payload shape',
        content: {
          'application/json': {
            schema: resolver(boardTaskSchema),
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
  jsonValidator(createTaskSchema),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.get('db');

    await assertColumnInProject(db, body.column_id, body.project_id);

    const labelIds = dedupe(body.label_ids ?? []);
    const assigneeIds = dedupe(body.assignee_ids ?? []);
    await assertLabelsInProject(db, labelIds, body.project_id);
    await assertUsersExist(db, assigneeIds);

    try {
      await db
        .insertInto('task')
        .values({
          id: body.id,
          project_id: body.project_id,
          column_id: body.column_id,
          title: body.title,
          description: serializeDescription(body.description),
          position: body.position,
        })
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Task id already in use');
      }
      throw err;
    }

    if (labelIds.length > 0) {
      await db
        .insertInto('task_label')
        .values(labelIds.map((label_id) => ({ task_id: body.id, label_id })))
        .execute();
    }
    if (assigneeIds.length > 0) {
      await db
        .insertInto('task_assignee')
        .values(assigneeIds.map((user_id) => ({ task_id: body.id, user_id })))
        .execute();
    }

    const created = await fetchBoardTask(db, body.id);
    if (!created) {
      throw new AppError(500, 'Failed to load created task');
    }
    return c.json(created.task, 201);
  }
);

router.get(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Get task detail',
    description: 'Get a task in board-payload shape plus its project id and images.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Task detail',
        content: {
          'application/json': {
            schema: resolver(taskDetailResponseSchema),
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

    const result = await fetchBoardTask(db, id);
    if (!result) {
      throw new AppError(404, 'Task not found');
    }

    const imageRows = await db
      .selectFrom('task_image')
      .select([
        'task_image.id',
        'task_image.filename',
        'task_image.content_type',
        'task_image.size_bytes',
        'task_image.created_at',
      ])
      .where('task_image.task_id', '=', id)
      .orderBy('task_image.created_at')
      .orderBy('task_image.id')
      .execute();

    const images = imageRows.map((image) => ({
      id: image.id,
      url: `/api/images/${image.id}`,
      filename: image.filename,
      content_type: image.content_type,
      size_bytes: image.size_bytes,
      created_at: image.created_at.toISOString(),
    }));

    return c.json({ ...result.task, project_id: result.project_id, images }, 200);
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Update a task',
    description:
      'Update title, description (a Tiptap doc, or null to clear it), or move the task by ' +
      'sending column_id and position together. The new column must belong to the task’s ' +
      'project; violations return 422 with a plain error body. Bumps updated_at.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated task in board-payload shape',
        content: {
          'application/json': {
            schema: resolver(boardTaskSchema),
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
  jsonValidator(patchTaskSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');

    const task = await db
      .selectFrom('task')
      .select('task.project_id')
      .where('task.id', '=', id)
      .executeTakeFirst();
    if (!task) {
      throw new AppError(404, 'Task not found');
    }

    if (body.column_id !== undefined) {
      await assertColumnInProject(db, body.column_id, task.project_id);
    }

    await db
      .updateTable('task')
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...('description' in body ? { description: serializeDescription(body.description) } : {}),
        ...(body.column_id !== undefined ? { column_id: body.column_id } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        updated_at: sql<Date>`now()`,
      })
      .where('task.id', '=', id)
      .execute();

    const updated = await fetchBoardTask(db, id);
    if (!updated) {
      throw new AppError(500, 'Failed to load updated task');
    }
    return c.json(updated.task, 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Delete a task',
    description:
      'Delete a task. Dependencies, labels, assignees, and images cascade; stored image ' +
      'objects are removed after commit.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Task deleted',
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

    const images = await db
      .selectFrom('task_image')
      .select('task_image.storage_key')
      .where('task_image.task_id', '=', id)
      .execute();

    const deleted = await db
      .deleteFrom('task')
      .where('task.id', '=', id)
      .returning('task.id')
      .executeTakeFirst();
    if (!deleted) {
      throw new AppError(404, 'Task not found');
    }

    if (images.length > 0) {
      const keys = images.map((image) => image.storage_key);
      c.get('postCommitHooks').push(async () => {
        await Promise.all(keys.map((key) => storage.delete(key)));
      });
    }

    return c.body(null, 204);
  }
);

router.put(
  '/:id/labels',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Set task labels',
    description:
      'Replace the full set of labels on a task. All labels must belong to the task’s ' +
      'project; violations return 422 with a plain error body.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Labels set',
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
  jsonValidator(setTaskLabelsSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { label_ids } = c.req.valid('json');
    const db = c.get('db');

    const task = await db
      .selectFrom('task')
      .select('task.project_id')
      .where('task.id', '=', id)
      .executeTakeFirst();
    if (!task) {
      throw new AppError(404, 'Task not found');
    }

    const desired = dedupe(label_ids);
    await assertLabelsInProject(db, desired, task.project_id);

    let removal = db.deleteFrom('task_label').where('task_label.task_id', '=', id);
    if (desired.length > 0) {
      removal = removal.where('task_label.label_id', 'not in', desired);
    }
    await removal.execute();

    if (desired.length > 0) {
      await db
        .insertInto('task_label')
        .values(desired.map((label_id) => ({ task_id: id, label_id })))
        .onConflict((oc) => oc.columns(['task_id', 'label_id']).doNothing())
        .execute();
    }

    return c.body(null, 204);
  }
);

router.put(
  '/:id/assignees',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Set task assignees',
    description:
      'Replace the full set of assignees on a task. All user ids must reference existing ' +
      'users; violations return 422 with a plain error body.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Assignees set',
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
  jsonValidator(setTaskAssigneesSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { user_ids } = c.req.valid('json');
    const db = c.get('db');

    const task = await db
      .selectFrom('task')
      .select('task.id')
      .where('task.id', '=', id)
      .executeTakeFirst();
    if (!task) {
      throw new AppError(404, 'Task not found');
    }

    const desired = dedupe(user_ids);
    await assertUsersExist(db, desired);

    let removal = db.deleteFrom('task_assignee').where('task_assignee.task_id', '=', id);
    if (desired.length > 0) {
      removal = removal.where('task_assignee.user_id', 'not in', desired);
    }
    await removal.execute();

    if (desired.length > 0) {
      await db
        .insertInto('task_assignee')
        .values(desired.map((user_id) => ({ task_id: id, user_id })))
        .onConflict((oc) => oc.columns(['task_id', 'user_id']).doNothing())
        .execute();
    }

    return c.body(null, 204);
  }
);

router.post(
  '/:id/blockers',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Add a blocker',
    description:
      'Add a dependency: the task in the body blocks the task in the path. The blocker must ' +
      'be a different task in the same project (422 with a plain error body otherwise). ' +
      'Adding an existing blocker is an idempotent 204. A dependency cycle returns 409.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Blocker added (or already present)',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(addBlockerSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { blocker_task_id } = c.req.valid('json');
    const db = c.get('db');

    const task = await db
      .selectFrom('task')
      .select('task.project_id')
      .where('task.id', '=', id)
      .executeTakeFirst();
    if (!task) {
      throw new AppError(404, 'Task not found');
    }

    if (blocker_task_id === id) {
      throw new AppError(422, 'A task cannot block itself');
    }

    const blocker = await db
      .selectFrom('task')
      .select('task.project_id')
      .where('task.id', '=', blocker_task_id)
      .executeTakeFirst();
    if (!blocker || blocker.project_id !== task.project_id) {
      throw new AppError(422, 'blocker_task_id must reference a task in the same project');
    }

    await lockProjectDependencies(db, task.project_id);
    if (await wouldCreateDependencyCycle(db, id, blocker_task_id)) {
      throw new AppError(409, 'Adding this blocker would create a dependency cycle');
    }

    await db
      .insertInto('task_dependency')
      .values({ blocker_task_id, blocked_task_id: id })
      .onConflict((oc) => oc.columns(['blocker_task_id', 'blocked_task_id']).doNothing())
      .execute();

    return c.body(null, 204);
  }
);

router.delete(
  '/:id/blockers/:blockerTaskId',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Remove a blocker',
    description: 'Remove a dependency. Idempotent: removing an absent blocker still returns 204.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Blocker removed (or already absent)',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(taskBlockerParamsSchema),
  async (c) => {
    const { id, blockerTaskId } = c.req.valid('param');
    const db = c.get('db');

    await db
      .deleteFrom('task_dependency')
      .where('task_dependency.blocked_task_id', '=', id)
      .where('task_dependency.blocker_task_id', '=', blockerTaskId)
      .execute();

    return c.body(null, 204);
  }
);

export default router;
