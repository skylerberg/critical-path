import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql, type Kysely } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import type { DB } from '../db/types';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import {
  assertProjectAccess,
  assertTaskAccess,
  canAccessProject,
  projectAccessIdsAmong,
  type ProjectAccessFields,
} from '../services/authorization';
import { dueDateText } from '../services/dueDate';
import { notifyMentions } from '../services/mentions';
import { storage } from '../services/storage/index';
import {
  findDependencyCyclePath,
  lockProjectDependencies,
  wouldCreateDependencyCycle,
} from '../services/dependencies';
import { publishAfterCommit } from '../services/realtime/index';
import {
  fetchTaskActivity,
  recordAssigneeChanges,
  recordDescriptionChange,
  recordTaskActivity,
} from '../services/taskActivity';
import {
  fetchTaskRelations,
  publishTaskRelationsSet,
  unarchivedBlockerIds,
} from '../services/taskRelations';
import {
  idSchema,
  createTaskSchema,
  patchTaskSchema,
  taskDetailResponseSchema,
  archivedTaskSchema,
  addBlockerSchema,
  setTaskLabelsSchema,
  setTaskAssigneesSchema,
  taskBlockerParamsSchema,
  taskActivityResponseSchema,
  boardTaskSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  preconditionConflictErrorResponse,
  dependencyCycleErrorResponse,
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
): Promise<{ task: BoardTask; project_id: string; archived_at: string | null } | undefined> {
  const row = await db
    .selectFrom('task')
    .select((eb) => [
      'task.id',
      'task.project_id',
      'task.column_id',
      'task.title',
      'task.description',
      'task.position',
      dueDateText.as('due_date'),
      'task.created_at',
      'task.updated_at',
      'task.archived_at',
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
      unarchivedBlockerIds(eb).as('blockers'),
      eb
        .selectFrom('task_image')
        .select((ib) => ib.fn.countAll<string>().as('count'))
        .whereRef('task_image.task_id', '=', 'task.id')
        .as('image_count'),
      eb
        .selectFrom('task_comment')
        .select((cb) => cb.fn.countAll<string>().as('count'))
        .whereRef('task_comment.task_id', '=', 'task.id')
        .as('comment_count'),
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
      due_date: row.due_date,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      label_ids: row.labels.map((l) => l.label_id),
      assignee_ids: row.assignees.map((a) => a.user_id),
      blocker_ids: row.blockers.map((b) => b.blocker_task_id),
      image_count: Number(row.image_count ?? 0),
      comment_count: Number(row.comment_count ?? 0),
    },
    project_id: row.project_id,
    archived_at: row.archived_at?.toISOString() ?? null,
  };
}

async function assertColumnInProject(
  db: Kysely<DB>,
  columnId: string,
  projectId: string
): Promise<{ project_id: string; name: string }> {
  const column = await db
    .selectFrom('board_column')
    .select(['board_column.project_id', 'board_column.name'])
    .where('board_column.id', '=', columnId)
    .executeTakeFirst();
  if (!column || column.project_id !== projectId) {
    throw new AppError(422, 'column_id must reference a column in the project');
  }
  return column;
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

async function assertAssigneesHaveProjectAccess(
  db: Kysely<DB>,
  userIds: string[],
  project: ProjectAccessFields
): Promise<void> {
  const withAccess = await projectAccessIdsAmong(db, project, userIds);
  if (withAccess.length !== userIds.length) {
    throw new AppError(422, 'assignee user ids must reference users with access to the project');
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
      'Create a task in a column. The client supplies the task id. An unknown or inaccessible ' +
      'project returns 404. The column must belong to the project, labels must belong to the ' +
      'project, and assignees must be users with access to the project; those violations return ' +
      '422 with a plain error body. due_date is an optional calendar day (YYYY-MM-DD, no time ' +
      'and no timezone); anything else returns 422.',
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
      ...notFoundErrorResponse,
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
    const user = c.get('user');

    const project = await db
      .selectFrom('project')
      .select(['id', 'created_by'])
      .where('id', '=', body.project_id)
      .executeTakeFirst();
    if (!project || !(await canAccessProject(db, user.id, project))) {
      throw new AppError(404, 'Project not found');
    }

    await assertColumnInProject(db, body.column_id, body.project_id);

    const labelIds = dedupe(body.label_ids ?? []);
    const assigneeIds = dedupe(body.assignee_ids ?? []);
    await assertLabelsInProject(db, labelIds, body.project_id);
    await assertAssigneesHaveProjectAccess(db, assigneeIds, project);

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
          due_date: body.due_date ?? null,
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

    await recordTaskActivity(db, user.id, [
      { taskId: body.id, kind: 'created', newValue: { text: body.title } },
    ]);

    await notifyMentions(c, {
      actorUserId: user.id,
      project,
      taskId: body.id,
      source: 'description',
      previous: null,
      next: body.description ?? null,
    });

    const created = await fetchBoardTask(db, body.id);
    if (!created) {
      throw new AppError(500, 'Failed to load created task');
    }
    publishAfterCommit(c, 'task_created', body.project_id, created.task);
    return c.json(created.task, 201);
  }
);

router.get(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Get task detail',
    description:
      'Get a task in board-payload shape plus its project id, archived_at (null unless the ' +
      'task is archived), images, and its full comment stream oldest first. Archived tasks ' +
      'are readable here even though they are absent from every board payload.',
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
    const user = c.get('user');

    const result = await fetchBoardTask(db, id);
    if (!result) {
      throw new AppError(404, 'Task not found');
    }
    await assertProjectAccess(db, user.id, result.project_id, 'Task not found');

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

    const commentRows = await db
      .selectFrom('task_comment')
      .select([
        'task_comment.id',
        'task_comment.task_id',
        'task_comment.user_id',
        'task_comment.body',
        'task_comment.created_at',
        'task_comment.updated_at',
      ])
      .where('task_comment.task_id', '=', id)
      .orderBy('task_comment.created_at')
      .orderBy('task_comment.id')
      .execute();

    const comments = commentRows.map((comment) => ({
      id: comment.id,
      task_id: comment.task_id,
      user_id: comment.user_id,
      body: comment.body as unknown as TiptapDoc,
      created_at: comment.created_at.toISOString(),
      updated_at: comment.updated_at.toISOString(),
    }));

    return c.json(
      {
        ...result.task,
        project_id: result.project_id,
        archived_at: result.archived_at,
        images,
        comments,
      },
      200
    );
  }
);

router.get(
  '/:id/activity',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Get task activity',
    description:
      'The task’s activity log, oldest first: who created it, retitled it, edited its ' +
      'description, moved it between columns, set, changed or cleared its due date, added or ' +
      'removed a label, an assignee or a blocker, and who archived or restored it. A due-date ' +
      'entry carries the calendar day as text, with a null old value when it was first set and ' +
      'a null new value when it was cleared. Each entry carries the actor, the time, and ' +
      'the old and new value of what changed, with column, label, user and blocker names ' +
      'snapshotted as they were at the time. The log is append-only and starts when a task ' +
      'is created, so tasks that predate this feature read as empty until they next change. ' +
      'Consecutive description edits by one actor within a few minutes are recorded as a ' +
      'single entry whose old value is the text from before that session.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Activity entries, oldest first',
        content: {
          'application/json': {
            schema: resolver(taskActivityResponseSchema),
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

    await assertTaskAccess(db, c.get('user').id, id);

    return c.json({ activity: await fetchTaskActivity(db, id) }, 200);
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Update a task',
    description:
      'Update title, description (a Tiptap doc, or null to clear it), due_date (a calendar day ' +
      'YYYY-MM-DD, or null to clear it; omit it to leave it alone), or move the task by ' +
      'sending column_id and position together. The new column must belong to the task’s ' +
      'project and due_date must be a real calendar day; violations return 422 with a plain ' +
      'error body. updated_at is bumped only when the patch changes title or description — a ' +
      'pure move or due-date change leaves it untouched. ' +
      'expected_updated_at is an optimistic-concurrency precondition on the task’s content: ' +
      'it is honored only when the patch includes title or description, a patch that only ' +
      'moves the task or sets its due date is always last-write-wins and ignores it, and a ' +
      'precondition that does not match the stored updated_at returns 409 and writes nothing.',
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
      ...preconditionConflictErrorResponse,
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
    const actorId = c.get('user').id;

    const project = await assertTaskAccess(db, actorId, id);

    const newColumn =
      body.column_id === undefined
        ? null
        : await assertColumnInProject(db, body.column_id, project.id);

    // Gates the bump as well as the check: a move that moved updated_at would invalidate every
    // other open editor's precondition.
    const guardsContent = body.title !== undefined || 'description' in body;
    const nextDescription = 'description' in body ? serializeDescription(body.description) : null;

    // Read under the same lock the UPDATE takes, so two concurrent patches cannot both read
    // the pre-update row: that would pass both preconditions, and it would log two
    // transitions out of a value only one of them saw.
    const before =
      guardsContent || body.column_id !== undefined || 'due_date' in body
        ? await db
            .selectFrom('task')
            .innerJoin('board_column', 'board_column.id', 'task.column_id')
            .select([
              'task.title',
              'task.description',
              'task.column_id',
              'task.updated_at',
              'board_column.name as column_name',
              dueDateText.as('due_date'),
              // Postgres normalizes jsonb key order on storage, so only jsonb equality can
              // tell an unchanged description from a re-serialized one.
              sql<boolean>`task.description is distinct from ${nextDescription}::jsonb`.as(
                'description_changed'
              ),
            ])
            .where('task.id', '=', id)
            .forNoKeyUpdate('task')
            .executeTakeFirst()
        : null;
    if (before === undefined) {
      throw new AppError(404, 'Task not found');
    }

    // Compared in JS, never in SQL: timestamptz keeps microseconds the millisecond-precision
    // ISO string a client echoes back cannot carry.
    if (
      guardsContent &&
      body.expected_updated_at !== undefined &&
      before !== null &&
      before.updated_at.getTime() !== Date.parse(body.expected_updated_at)
    ) {
      throw new AppError(409, 'This task changed since you loaded it');
    }

    const changes = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...('description' in body ? { description: nextDescription } : {}),
      ...(body.column_id !== undefined ? { column_id: body.column_id } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
      ...('due_date' in body ? { due_date: body.due_date ?? null } : {}),
      ...(guardsContent ? { updated_at: sql<Date>`now()` } : {}),
    };

    // Every field is optional and an empty body validates, so without this a `{}` patch would
    // compile to an UPDATE with an empty SET list.
    if (Object.keys(changes).length > 0) {
      await db.updateTable('task').set(changes).where('task.id', '=', id).execute();
    }

    if (before !== null) {
      // Written one at a time, in this order, so the entries read in the order the fields
      // appear on the card and a rename cannot be swallowed by a coalesced description edit.
      if (body.title !== undefined && body.title !== before.title) {
        await recordTaskActivity(db, actorId, [
          {
            taskId: id,
            kind: 'title_changed',
            oldValue: { text: before.title },
            newValue: { text: body.title },
          },
        ]);
      }
      if ('description' in body && before.description_changed) {
        await recordDescriptionChange(
          db,
          actorId,
          id,
          before.description as TiptapDoc | null,
          body.description ?? null
        );
      }
      if (
        body.column_id !== undefined &&
        newColumn !== null &&
        body.column_id !== before.column_id
      ) {
        await recordTaskActivity(db, actorId, [
          {
            taskId: id,
            kind: 'column_changed',
            oldValue: { id: before.column_id, name: before.column_name },
            newValue: { id: body.column_id, name: newColumn.name },
          },
        ]);
      }
      const nextDueDate = body.due_date ?? null;
      if ('due_date' in body && nextDueDate !== before.due_date) {
        await recordTaskActivity(db, actorId, [
          {
            taskId: id,
            kind: 'due_date_changed',
            oldValue: before.due_date === null ? null : { text: before.due_date },
            newValue: nextDueDate === null ? null : { text: nextDueDate },
          },
        ]);
      }
    }

    if ('description' in body && before !== null) {
      await notifyMentions(c, {
        actorUserId: actorId,
        project,
        taskId: id,
        source: 'description',
        previous: before.description,
        next: body.description ?? null,
      });
    }

    const updated = await fetchBoardTask(db, id);
    if (!updated) {
      throw new AppError(500, 'Failed to load updated task');
    }
    publishAfterCommit(c, 'task_updated', project.id, updated.task);
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
    const actorId = c.get('user').id;

    const project = await assertTaskAccess(db, actorId, id);

    const images = await db
      .selectFrom('task_image')
      .select('task_image.storage_key')
      .where('task_image.task_id', '=', id)
      .execute();

    // Read before the delete, which takes the edges with it by cascade.
    const dependents = await db
      .selectFrom('task_dependency')
      .select('task_dependency.blocked_task_id')
      .where('task_dependency.blocker_task_id', '=', id)
      .execute();

    const deleted = await db
      .deleteFrom('task')
      .where('task.id', '=', id)
      .returning('task.title')
      .executeTakeFirst();
    if (!deleted) {
      throw new AppError(404, 'Task not found');
    }

    // This card's own log dies with it; the cards it was blocking outlive it and would
    // otherwise show a blocker that vanished with nothing to explain it.
    await recordTaskActivity(
      db,
      actorId,
      dependents.map((dependent) => ({
        taskId: dependent.blocked_task_id,
        kind: 'blocker_removed' as const,
        oldValue: { id, name: deleted.title },
      }))
    );

    if (images.length > 0) {
      const keys = images.map((image) => image.storage_key);
      c.get('postCommitHooks').push(async () => {
        await Promise.all(keys.map((key) => storage.delete(key)));
      });
    }

    publishAfterCommit(c, 'task_deleted', project.id, { id });
    return c.body(null, 204);
  }
);

router.post(
  '/:id/archive',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Archive a task',
    description:
      'Archive a task: a soft delete that keeps the row and every dependency edge but takes ' +
      'the task out of the board payload, out of every blocker and dependent list, and out ' +
      'of the project task counts. Archiving an already archived task is an idempotent 200 ' +
      'that keeps the original archived_at. updated_at is not bumped — the card’s content ' +
      'did not change.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Archived task in board-payload shape plus archived_at',
        content: {
          'application/json': {
            schema: resolver(archivedTaskSchema),
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

    const project = await assertTaskAccess(db, c.get('user').id, id);

    const archived = await db
      .updateTable('task')
      .set({ archived_at: sql<Date>`now()` })
      .where('task.id', '=', id)
      .where('task.archived_at', 'is', null)
      .returning('task.id')
      .executeTakeFirst();

    const row = await fetchBoardTask(db, id);
    if (!row || row.archived_at === null) {
      throw new AppError(500, 'Failed to load archived task');
    }
    const body = { ...row.task, archived_at: row.archived_at };
    if (archived) {
      await recordTaskActivity(db, c.get('user').id, [{ taskId: id, kind: 'archived' }]);
      publishAfterCommit(c, 'task_archived', project.id, body);
    }
    return c.json(body, 200);
  }
);

router.post(
  '/:id/restore',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Restore an archived task',
    description:
      'Put an archived task back on the board in the column and position it left from, with ' +
      'every dependency edge it had before intact. Restoring a task that is not archived is ' +
      'an idempotent 200 that changes nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Restored task in board-payload shape',
        content: {
          'application/json': {
            schema: resolver(boardTaskSchema),
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

    const project = await assertTaskAccess(db, c.get('user').id, id);

    const restored = await db
      .updateTable('task')
      .set({ archived_at: null })
      .where('task.id', '=', id)
      .where('task.archived_at', 'is not', null)
      .returning('task.id')
      .executeTakeFirst();

    const row = await fetchBoardTask(db, id);
    if (!row) {
      throw new AppError(500, 'Failed to load restored task');
    }

    if (restored) {
      await recordTaskActivity(db, c.get('user').id, [{ taskId: id, kind: 'restored' }]);
      publishAfterCommit(c, 'task_restored', project.id, row.task);
      // The dependents' side of each edge is not derivable from the restored task
      // alone, so their blocker_ids have to be republished.
      const dependents = await db
        .selectFrom('task_dependency')
        .innerJoin('task', 'task.id', 'task_dependency.blocked_task_id')
        .select('task_dependency.blocked_task_id')
        .where('task_dependency.blocker_task_id', '=', id)
        .where('task.archived_at', 'is', null)
        .execute();
      publishTaskRelationsSet(
        c,
        await fetchTaskRelations(
          db,
          dependents.map((dependent) => dependent.blocked_task_id)
        )
      );
    }

    return c.json(row.task, 200);
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

    const actorId = c.get('user').id;
    const project = await assertTaskAccess(db, actorId, id);

    const desired = dedupe(label_ids);
    await assertLabelsInProject(db, desired, project.id);

    let removal = db.deleteFrom('task_label').where('task_label.task_id', '=', id);
    if (desired.length > 0) {
      removal = removal.where('task_label.label_id', 'not in', desired);
    }
    // `do nothing` returns no row for a pair that was already there, so `returning`
    // yields the exact added and removed sets.
    const removed = await removal.returning('task_label.label_id').execute();

    const added =
      desired.length === 0
        ? []
        : await db
            .insertInto('task_label')
            .values(desired.map((label_id) => ({ task_id: id, label_id })))
            .onConflict((oc) => oc.columns(['task_id', 'label_id']).doNothing())
            .returning('task_label.label_id')
            .execute();

    const changedIds = [...removed, ...added].map((row) => row.label_id);
    if (changedIds.length > 0) {
      const names = new Map(
        (
          await db
            .selectFrom('label')
            .select(['label.id', 'label.name'])
            .where('label.id', 'in', changedIds)
            .execute()
        ).map((label) => [label.id, label.name])
      );
      await recordTaskActivity(db, actorId, [
        ...removed.map((row) => ({
          taskId: id,
          kind: 'label_removed' as const,
          oldValue: { id: row.label_id, name: names.get(row.label_id) ?? '' },
        })),
        ...added.map((row) => ({
          taskId: id,
          kind: 'label_added' as const,
          newValue: { id: row.label_id, name: names.get(row.label_id) ?? '' },
        })),
      ]);
    }

    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
    return c.body(null, 204);
  }
);

router.put(
  '/:id/assignees',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Set task assignees',
    description:
      'Replace the full set of assignees on a task. Newly added user ids must reference ' +
      'users with access to the project (422 with a plain error body otherwise); ids already ' +
      'assigned are never re-validated, so echoing the current set always succeeds.',
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

    const actorId = c.get('user').id;
    const project = await assertTaskAccess(db, actorId, id);

    const desired = dedupe(user_ids);
    const currentRows = await db
      .selectFrom('task_assignee')
      .select('task_assignee.user_id')
      .where('task_assignee.task_id', '=', id)
      .execute();
    const current = new Set(currentRows.map((row) => row.user_id));
    const added = desired.filter((userId) => !current.has(userId));
    await assertAssigneesHaveProjectAccess(db, added, project);

    let removal = db.deleteFrom('task_assignee').where('task_assignee.task_id', '=', id);
    if (desired.length > 0) {
      removal = removal.where('task_assignee.user_id', 'not in', desired);
    }
    const removed = (await removal.returning('task_assignee.user_id').execute()).map(
      (row) => row.user_id
    );

    if (desired.length > 0) {
      await db
        .insertInto('task_assignee')
        .values(desired.map((user_id) => ({ task_id: id, user_id })))
        .onConflict((oc) => oc.columns(['task_id', 'user_id']).doNothing())
        .execute();
    }

    await recordAssigneeChanges(db, actorId, [
      ...removed.map((userId) => ({ taskId: id, kind: 'assignee_removed' as const, userId })),
      ...added.map((userId) => ({ taskId: id, kind: 'assignee_added' as const, userId })),
    ]);

    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
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
      'be a different, unarchived task in the same project (422 with a plain error body ' +
      'otherwise); the task being blocked may itself be archived, which is what lets a ' +
      'restore bring its edges back. Adding an existing blocker is an idempotent 204. ' +
      'A dependency cycle returns 409. ' +
      'On 409 the body also carries `cycle`: the offending loop as `{ id, title }` entries, ' +
      'starting at the task in the path, each entry blocking the next, ending at ' +
      '`blocker_task_id`, and repeating the first entry last. It is empty when no path is ' +
      'recoverable.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Blocker added (or already present)',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...dependencyCycleErrorResponse,
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

    const actorId = c.get('user').id;
    const project = await assertTaskAccess(db, actorId, id);

    if (blocker_task_id === id) {
      throw new AppError(422, 'A task cannot block itself');
    }

    const blocker = await db
      .selectFrom('task')
      .select(['task.project_id', 'task.archived_at', 'task.title'])
      .where('task.id', '=', blocker_task_id)
      .executeTakeFirst();
    if (!blocker || blocker.project_id !== project.id) {
      throw new AppError(422, 'blocker_task_id must reference a task in the same project');
    }
    // Board reads hide archived blockers, so allowing this would hand the task an
    // edge no client could ever display or remove.
    if (blocker.archived_at !== null) {
      throw new AppError(422, 'blocker_task_id must not reference an archived task');
    }

    await lockProjectDependencies(db, project.id);
    if (await wouldCreateDependencyCycle(db, id, blocker_task_id)) {
      const cycle = await findDependencyCyclePath(db, project.id, id, blocker_task_id);
      throw new AppError(409, 'Adding this blocker would create a dependency cycle', { cycle });
    }

    const inserted = await db
      .insertInto('task_dependency')
      .values({ blocker_task_id, blocked_task_id: id })
      .onConflict((oc) => oc.columns(['blocker_task_id', 'blocked_task_id']).doNothing())
      .returning('task_dependency.blocker_task_id')
      .executeTakeFirst();

    if (inserted) {
      await recordTaskActivity(db, actorId, [
        {
          taskId: id,
          kind: 'blocker_added',
          newValue: { id: blocker_task_id, name: blocker.title },
        },
      ]);
    }

    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
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
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(taskBlockerParamsSchema),
  async (c) => {
    const { id, blockerTaskId } = c.req.valid('param');
    const db = c.get('db');

    const actorId = c.get('user').id;
    await assertTaskAccess(db, actorId, id);

    const removed = await db
      .deleteFrom('task_dependency')
      .using('task')
      .whereRef('task.id', '=', 'task_dependency.blocker_task_id')
      .where('task_dependency.blocked_task_id', '=', id)
      .where('task_dependency.blocker_task_id', '=', blockerTaskId)
      .returning(['task_dependency.blocker_task_id', 'task.title'])
      .executeTakeFirst();

    if (removed) {
      await recordTaskActivity(db, actorId, [
        {
          taskId: id,
          kind: 'blocker_removed',
          oldValue: { id: removed.blocker_task_id, name: removed.title },
        },
      ]);
    }

    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
    return c.body(null, 204);
  }
);

export default router;
