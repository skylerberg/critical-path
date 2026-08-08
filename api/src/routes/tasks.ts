import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { sql, type Kysely } from 'kysely';
import type { DB, ResolvedSortKey } from '../db/types';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { dedupe } from '../utils/arrays';
import { AppError, isUniqueViolation } from '../utils/errors';
import {
  accessibleProjectsFilter,
  assertProjectAccess,
  assertProjectWrite,
  assertTaskAccess,
  assertTaskWrite,
} from '../services/authorization';
import {
  attachmentStorageKeys,
  fetchTaskAttachments,
  IMAGE_KIND,
} from '../services/attachments/index';
import { setTaskCoverImage } from '../services/attachments/images';
import { assertColumnInProject } from '../services/boardColumns';
import { appendKeys, resolveSortKey, resolveSortKeys } from '../services/sortKey';
import { fetchBoardTaskRows, type BoardTaskRow } from '../services/boardPayload';
import { dueDateText } from '../services/dateText';
import { serializeDescription } from '../services/description';
import { notifyMentions } from '../services/mentions';
import { notify } from '../services/notifications';
import { copyTasks } from '../services/projectCopy';
import { assertAssigneesHaveProjectAccess, assertLabelsInProject } from '../services/projectScope';
import { assertLockedTaskCapacity, assertTaskCapacity } from '../services/taskCap';
import { MAX_TASKS_PER_PROJECT } from '../config/constants';
import { deleteStoredObjectsAfterCommit } from '../services/storage/cleanup';
import {
  findDependencyCyclePath,
  lockDependencyProjects,
  wouldCreateDependencyCycle,
} from '../services/dependencies';
import {
  crossProjectDependentsOf,
  getCrossProjectDependencies,
  publishCrossProjectBlockerCounts,
  refreshCrossProjectBlockerCounts,
  syncCrossProjectBlockers,
} from '../services/crossProjectBlockers';
import { publishAfterCommit } from '../services/realtime/index';
import {
  fetchTaskActivity,
  recordAssigneeChanges,
  recordDescriptionChange,
  recordTaskActivity,
} from '../services/taskActivity';
import { fetchTaskRelations, publishTaskRelationsSet } from '../services/taskRelations';
import { seriesSummaryForTask } from '../services/taskSeries/read';
import {
  idSchema,
  createTaskSchema,
  createTasksBatchSchema,
  tasksBatchResponseSchema,
  patchTaskSchema,
  taskDetailResponseSchema,
  archivedTaskSchema,
  addBlockerSchema,
  setTaskLabelsSchema,
  setTaskAssigneesSchema,
  setTaskCoverSchema,
  taskBlockerParamsSchema,
  taskActivityResponseSchema,
  crossProjectDependenciesResponseSchema,
  boardTaskSchema,
  duplicateSchema,
  jsonResponse,
  emptyResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  preconditionConflictErrorResponse,
  dependencyCycleErrorResponse,
  unprocessableErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
  type TiptapDoc,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

// One message for a blocker that does not exist and one the caller may not see,
// so the route cannot be used to test whether a task id is real — the same rule
// the bulk skip lists follow.
const BLOCKER_UNREACHABLE = 'blocker_task_id must reference a task in a project you can access';

async function fetchBoardTask(db: Kysely<DB>, taskId: string): Promise<BoardTaskRow | undefined> {
  return (await fetchBoardTaskRows(db, [taskId]))[0];
}

const createTaskResponses = {
  201: jsonResponse('Created task in board-payload shape', boardTaskSchema),
};

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
      'and no timezone); anything else returns 422. A project holds at most ' +
      `${String(MAX_TASKS_PER_PROJECT)} tasks, archived ones included; past that, creating one ` +
      'returns 422 while reading and editing the existing cards keeps working.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createTaskResponses,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createTaskSchema),
  async (c): Promise<Returned<typeof createTaskResponses>> => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertProjectWrite(db, user.id, body.project_id);

    await assertTaskCapacity(db, body.project_id, 1);
    await assertColumnInProject(db, body.column_id, body.project_id);

    const labelIds = dedupe(body.label_ids ?? []);
    const assigneeIds = dedupe(body.assignee_ids ?? []);
    await assertLabelsInProject(db, labelIds, body.project_id);
    await assertAssigneesHaveProjectAccess(db, assigneeIds, project);

    try {
      const sortKey =
        body.sort_key === undefined
          ? (await appendKeys(db, 'task', body.column_id))[0]!
          : await resolveSortKey(db, 'task', body.column_id, body.sort_key);
      await db
        .insertInto('task')
        .values({
          id: body.id,
          project_id: body.project_id,
          column_id: body.column_id,
          title: body.title,
          description: serializeDescription(body.description),
          sort_key: sortKey,
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

    // Notifies nobody today: no mention deliverer is registered.
    await notifyMentions(c, {
      actorUserId: user.id,
      project,
      taskId: body.id,
      source: 'description',
      previous: null,
      next: body.description ?? null,
    });

    await notify(c, {
      kind: 'task_assigned',
      actor: user,
      project,
      taskId: body.id,
      recipientUserIds: assigneeIds,
    });

    const created = await fetchBoardTask(db, body.id);
    if (!created) {
      throw new AppError(500, 'Failed to load created task');
    }
    publishAfterCommit(c, 'task_created', body.project_id, created.task);
    return c.json(created.task, 201);
  }
);

const duplicateTaskResponses = {
  201: jsonResponse('The copy, in board-payload shape', boardTaskSchema),
};

router.post(
  '/:id/duplicate',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Duplicate a task',
    description:
      'Copy a task into the same column. The copy carries the title, description, due date, ' +
      'labels, assignees, images and cover image of the original, each image copied to its own ' +
      'stored object so deleting one leaves the other intact. It carries no dependency edges: ' +
      'a copy keeps an edge only when both of its ends are copied too, which one card never ' +
      'is. It carries no comments and no activity history either — the copy’s log starts ' +
      'with its own created entry. Duplicating an archived task produces a live card. The ' +
      'client supplies the new id and its position; a duplicate id returns 409. A project ' +
      `already holding ${String(MAX_TASKS_PER_PROJECT)} tasks, archived ones included, returns 422.`,
    security: [{ bearerAuth: [] }],
    responses: {
      ...duplicateTaskResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(duplicateSchema),
  async (c): Promise<Returned<typeof duplicateTaskResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const project = await assertTaskWrite(db, actorId, id);

    await assertLockedTaskCapacity(db, project.id, 1);

    // The caller ranks the copy against the cards it can see, which excludes the
    // archived ones still holding keys in that column, so a collision here is
    // ordinary rather than a duplicate id.
    const copy = async (sortKey: ResolvedSortKey | undefined): Promise<void> => {
      await copyTasks(db, {
        sourceTaskIds: [id],
        projectId: project.id,
        actorUserId: actorId,
        columnIdFor: (columnId) => columnId,
        sortKeyFor: () => sortKey,
        newIdFor: () => body.id,
        copyAssignees: true,
      });
    };

    try {
      if (body.sort_key === undefined) {
        await copy(undefined);
      } else {
        const source = await db
          .selectFrom('task')
          .select('task.column_id')
          .where('task.id', '=', id)
          .executeTakeFirstOrThrow();
        await copy(await resolveSortKey(db, 'task', source.column_id, body.sort_key));
      }
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Task id already in use');
      }
      throw err;
    }

    const created = await fetchBoardTask(db, body.id);
    if (!created) {
      throw new AppError(500, 'Failed to load duplicated task');
    }
    publishAfterCommit(c, 'task_created', project.id, created.task);
    return c.json(created.task, 201);
  }
);

const createTasksBatchResponses = {
  201: jsonResponse(
    'Created tasks in board-payload shape, in request order',
    tasksBatchResponseSchema
  ),
};

router.post(
  '/batch',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Create tasks in bulk',
    description:
      'Create between 1 and 100 tasks in one column of one project in a single request, for ' +
      'pasting a list. The client supplies every task id, so a retry after a dropped response ' +
      'cannot double-create. Each item carries only a title and a position: descriptions, ' +
      'due dates, labels and assignees are set afterwards with the single-task endpoints. ' +
      'The batch is all or nothing — a duplicate id, whether it already exists or is repeated ' +
      'inside the batch, returns 409 and creates none of them. An unknown or inaccessible ' +
      'project returns 404 and a column_id outside the project returns 422, as does a batch ' +
      `that would take the project past its ${String(MAX_TASKS_PER_PROJECT)}-task ceiling. Each ` +
      'created task gets its own created activity entry and its own task_created event.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createTasksBatchResponses,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createTasksBatchSchema),
  async (c): Promise<Returned<typeof createTasksBatchResponses>> => {
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');
    const taskIds = body.tasks.map((task) => task.id);

    await assertProjectWrite(db, user.id, body.project_id);

    // Unlocked like the single create and for the same reason: a batch is one
    // paste from the same board, capped at 100 items, not a bulk copy.
    await assertTaskCapacity(db, body.project_id, body.tasks.length);
    await assertColumnInProject(db, body.column_id, body.project_id);

    try {
      const keys = await resolveSortKeys(
        db,
        'task',
        body.column_id,
        body.tasks.map((task) => task.sort_key)
      );
      await db
        .insertInto('task')
        .values(
          body.tasks.map((task, index) => ({
            id: task.id,
            project_id: body.project_id,
            column_id: body.column_id,
            title: task.title,
            sort_key: keys[index]!,
          }))
        )
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Task id already in use');
      }
      throw err;
    }

    await recordTaskActivity(
      db,
      user.id,
      body.tasks.map((task) => ({
        taskId: task.id,
        kind: 'created' as const,
        newValue: { text: task.title },
      }))
    );

    const rows = await fetchBoardTaskRows(db, taskIds);
    const byId = new Map(rows.map((row) => [row.task.id, row.task]));
    // The read makes no promise about row order; the response promises request
    // order.
    const tasks = taskIds.map((taskId) => {
      const created = byId.get(taskId);
      if (created === undefined) {
        throw new AppError(500, 'Failed to load created tasks');
      }
      return created;
    });

    for (const task of tasks) {
      publishAfterCommit(c, 'task_created', body.project_id, task);
    }
    return c.json({ tasks }, 201);
  }
);

const getTaskResponses = { 200: jsonResponse('Task detail', taskDetailResponseSchema) };

router.get(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Get task detail',
    description:
      'Get a task in board-payload shape plus its project id, archived_at (null unless the ' +
      'task is archived), its attachments, its full comment stream oldest first, and its ' +
      'checklist in list order. Archived tasks are readable here even though they are absent ' +
      'from every board payload. `series_summary` names the recurrence in English for a card a ' +
      'recurring series created, and is null for every other card — including one whose ' +
      'series has since been deleted.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...getTaskResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof getTaskResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const result = await fetchBoardTask(db, id);
    if (!result) {
      throw new AppError(404, 'Task not found');
    }
    await assertProjectAccess(db, user.id, result.project_id, 'Task not found');

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

    const checklistRows = await db
      .selectFrom('checklist_item')
      .selectAll()
      .where('checklist_item.task_id', '=', id)
      .orderBy('checklist_item.sort_key')
      .orderBy('checklist_item.id')
      .execute();

    const checklist_items = checklistRows.map((item) => ({
      id: item.id,
      task_id: item.task_id,
      text: item.text,
      checked: item.checked,
      sort_key: item.sort_key,
      created_at: item.created_at.toISOString(),
      updated_at: item.updated_at.toISOString(),
    }));

    const attachments = await fetchTaskAttachments(db, id);

    return c.json(
      {
        ...result.task,
        project_id: result.project_id,
        archived_at: result.archived_at,
        series_summary: await seriesSummaryForTask(db, id),
        comments,
        checklist_items,
        attachments,
      },
      200
    );
  }
);

const getTaskActivityResponses = {
  200: jsonResponse('Activity entries, oldest first', taskActivityResponseSchema),
};

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
      ...getTaskActivityResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof getTaskActivityResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    await assertTaskAccess(db, c.get('user').id, id);

    return c.json({ activity: await fetchTaskActivity(db, id) }, 200);
  }
);

const getCrossProjectDependenciesResponses = {
  200: jsonResponse(
    'Cross-project dependencies in both directions, plus the hidden counts',
    crossProjectDependenciesResponseSchema
  ),
};

router.get(
  '/:id/cross-project-dependencies',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Get a task’s dependencies in other projects',
    description:
      'The task’s dependency edges whose other end lives in a different project, fetched ' +
      'separately from the board because the board payload deliberately carries no identity ' +
      'for the remote side — only `open_cross_project_blocker_count`. `blocked_by` names the ' +
      'tasks blocking this one and `blocking` the tasks it blocks; both carry the remote ' +
      'title, project and done state, and both omit archived remote tasks exactly as ' +
      '`blocker_ids` does. An edge whose other end is in a project the caller cannot access ' +
      'is never listed: it is added to `hidden_blocked_by_count` or `hidden_blocking_count` ' +
      'instead, and only while it is open, so the counts reconcile with ' +
      '`open_cross_project_blocker_count` and never reveal that an unreadable task is done. ' +
      'A task the caller cannot read is 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...getCrossProjectDependenciesResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof getCrossProjectDependenciesResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const userId = c.get('user').id;

    await assertTaskAccess(db, userId, id);

    return c.json(await getCrossProjectDependencies(db, userId, id), 200);
  }
);

const patchTaskResponses = {
  200: jsonResponse('Updated task in board-payload shape', boardTaskSchema),
};

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
      'error body. A sort_key already taken in the destination — including by an archived card ' +
      'the caller cannot see — ranks the task immediately after the card holding it rather ' +
      'than failing, so the echoed sort_key is not always the one that was sent. ' +
      'updated_at is bumped only when the patch changes title or description — a ' +
      'pure move or due-date change leaves it untouched. ' +
      'expected_updated_at is an optimistic-concurrency precondition on the task’s content: ' +
      'it is honored only when the patch includes title or description, a patch that only ' +
      'moves the task or sets its due date is always last-write-wins and ignores it, and a ' +
      'precondition that does not match the stored updated_at returns 409 and writes nothing.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...patchTaskResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...preconditionConflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchTaskSchema),
  async (c): Promise<Returned<typeof patchTaskResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const project = await assertTaskWrite(db, actorId, id);

    const newColumn =
      body.column_id === undefined
        ? null
        : await assertColumnInProject(db, body.column_id, project.id);

    // Gates the bump as well as the check: a move that moved updated_at would
    // invalidate every other open editor's precondition.
    const guardsContent = body.title !== undefined || 'description' in body;
    const nextDescription = 'description' in body ? serializeDescription(body.description) : null;

    // Read under the same lock the UPDATE takes: two concurrent patches both
    // reading the pre-update row would pass both preconditions and log two
    // transitions out of a value only one of them saw.
    const before =
      guardsContent ||
      body.column_id !== undefined ||
      body.sort_key !== undefined ||
      'due_date' in body
        ? await db
            .selectFrom('task')
            .innerJoin('board_column', 'board_column.id', 'task.column_id')
            .select([
              'task.title',
              'task.description',
              'task.column_id',
              'task.updated_at',
              'board_column.name as column_name',
              'board_column.is_done as column_is_done',
              dueDateText.as('due_date'),
              // Postgres normalizes jsonb key order on storage, so only jsonb
              // equality tells an unchanged description from a re-serialized one.
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

    // Compared in JS, never in SQL: timestamptz keeps microseconds the
    // millisecond-precision ISO string a client echoes back cannot carry.
    if (
      guardsContent &&
      body.expected_updated_at !== undefined &&
      before !== null &&
      before.updated_at.getTime() !== Date.parse(body.expected_updated_at)
    ) {
      throw new AppError(409, 'This task changed since you loaded it');
    }

    const columnChanged =
      body.column_id !== undefined && before !== null && body.column_id !== before.column_id;

    // A key only ranks a card against its own column's, so a move that does not
    // carry one has to be re-ranked into the destination rather than keeping a
    // key that means nothing there -- and that the column may already hold. A
    // key the client did send ranks it against the live cards it can see, which
    // is not the whole scope the unique index covers: the archived cards in the
    // destination are still holding theirs.
    const destinationColumn = body.column_id ?? before?.column_id;
    const nextKey =
      destinationColumn === undefined
        ? undefined
        : body.sort_key !== undefined
          ? await resolveSortKey(db, 'task', destinationColumn, body.sort_key)
          : columnChanged
            ? (await appendKeys(db, 'task', destinationColumn))[0]!
            : undefined;

    const changes = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...('description' in body ? { description: nextDescription } : {}),
      ...(body.column_id !== undefined ? { column_id: body.column_id } : {}),
      ...(nextKey !== undefined ? { sort_key: nextKey } : {}),
      ...('due_date' in body ? { due_date: body.due_date ?? null } : {}),
      ...(guardsContent ? { updated_at: sql<Date>`now()` } : {}),
      ...(columnChanged ? { column_since: sql<Date>`now()` } : {}),
    };

    // Every field is optional and an empty body validates, so without this a
    // `{}` patch would compile to an UPDATE with an empty SET list.
    if (Object.keys(changes).length > 0) {
      try {
        await db.updateTable('task').set(changes).where('task.id', '=', id).execute();
      } catch (err) {
        // Resolving the key reads the column, and nothing holds it against a
        // card landing on the resolved slot in between.
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'That position was taken while the move was in flight');
        }
        throw err;
      }
    }

    if (before !== null) {
      // One at a time, in this order, so the entries read in the order the
      // fields appear on the card and a rename cannot be swallowed by a
      // coalesced description edit.
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
      // Notifies nobody today: no mention deliverer is registered.
      await notifyMentions(c, {
        actorUserId: actorId,
        project,
        taskId: id,
        source: 'description',
        previous: before.description,
        next: body.description ?? null,
      });
    }

    // Only crossing the done boundary can change what this task contributes to a
    // remote count, so an ordinary drag between two unfinished columns pays
    // nothing.
    if (
      columnChanged &&
      before !== null &&
      newColumn !== null &&
      before.column_is_done !== newColumn.is_done
    ) {
      await syncCrossProjectBlockers(c, db, { taskIds: [id] });
    }

    const updated = await fetchBoardTask(db, id);
    if (!updated) {
      throw new AppError(500, 'Failed to load updated task');
    }
    publishAfterCommit(c, 'task_updated', project.id, updated.task);
    return c.json(updated.task, 200);
  }
);

const deleteTaskResponses = { 204: emptyResponse('Task deleted') };

router.delete(
  '/:id',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Delete an archived task',
    description:
      'Permanently delete a task that has already been archived. A task still on the board is ' +
      'refused with 422: archiving is the reversible step and deletion is only reachable from ' +
      'the archive, so nothing can be destroyed in one action. Dependencies, labels, assignees, ' +
      'and images cascade; stored image objects are removed after commit.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...deleteTaskResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...unprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteTaskResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const project = await assertTaskWrite(db, actorId, id);

    // Locked, so a concurrent restore cannot put the task back on the board
    // between this check and the delete below.
    const target = await db
      .selectFrom('task')
      .select('task.archived_at')
      .where('task.id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!target) {
      throw new AppError(404, 'Task not found');
    }
    if (target.archived_at === null) {
      throw new AppError(422, 'Only an archived task can be deleted; archive it first');
    }

    const attachmentKeys = await attachmentStorageKeys(db, { taskIds: [id] });

    // Read before the delete, which takes the edges with it by cascade.
    const dependents = await db
      .selectFrom('task_dependency')
      .select('task_dependency.blocked_task_id')
      .where('task_dependency.blocker_task_id', '=', id)
      .execute();
    const remoteDependents = await crossProjectDependentsOf(db, { taskIds: [id] });
    const remoteDependentIds = new Set(remoteDependents.map((dependent) => dependent.task_id));

    const deleted = await db
      .deleteFrom('task')
      .where('task.id', '=', id)
      .returning('task.title')
      .executeTakeFirst();
    if (!deleted) {
      throw new AppError(404, 'Task not found');
    }

    // This card's own log dies with it; the cards it was blocking outlive it and
    // would otherwise show a blocker that vanished with nothing to explain it.
    // A dependent in another project gets the entry without the title: its
    // readers need no relation to this project.
    await recordTaskActivity(
      db,
      actorId,
      dependents.map((dependent) => ({
        taskId: dependent.blocked_task_id,
        kind: 'blocker_removed' as const,
        oldValue: {
          id,
          name: remoteDependentIds.has(dependent.blocked_task_id) ? '' : deleted.title,
        },
      }))
    );

    // The edges are gone by cascade, so this recomputes to the new lower value.
    publishCrossProjectBlockerCounts(
      c,
      await refreshCrossProjectBlockerCounts(db, [...remoteDependentIds])
    );

    deleteStoredObjectsAfterCommit(c, attachmentKeys);

    publishAfterCommit(c, 'task_deleted', project.id, { id });
    return c.body(null, 204);
  }
);

const archiveTaskResponses = {
  200: jsonResponse('Archived task in board-payload shape plus archived_at', archivedTaskSchema),
};

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
      ...archiveTaskResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof archiveTaskResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    const project = await assertTaskWrite(db, c.get('user').id, id);

    const archived = await db
      .updateTable('task')
      .set({ archived_at: sql<Date>`now()` })
      .where('task.id', '=', id)
      .where('task.archived_at', 'is', null)
      .returning('task.id')
      .executeTakeFirst();

    if (archived) {
      await syncCrossProjectBlockers(c, db, { taskIds: [id] });
    }

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

const restoreTaskResponses = {
  200: jsonResponse('Restored task in board-payload shape', boardTaskSchema),
};

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
      ...restoreTaskResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof restoreTaskResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    const project = await assertTaskWrite(db, c.get('user').id, id);

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
      // The dependents' side of each edge is not derivable from the restored
      // task alone, so their blocker_ids have to be republished. Same-project
      // only, because that is all blocker_ids holds; the dependents in other
      // projects learn about this through their recount instead.
      const dependents = await db
        .selectFrom('task_dependency')
        .innerJoin('task', 'task.id', 'task_dependency.blocked_task_id')
        .select('task_dependency.blocked_task_id')
        .where('task_dependency.blocker_task_id', '=', id)
        .where('task.archived_at', 'is', null)
        .where('task.project_id', '=', project.id)
        .execute();
      publishTaskRelationsSet(
        c,
        await fetchTaskRelations(
          db,
          dependents.map((dependent) => dependent.blocked_task_id)
        )
      );
      await syncCrossProjectBlockers(c, db, { taskIds: [id] });
    }

    return c.json(row.task, 200);
  }
);

const setTaskLabelsResponses = { 204: emptyResponse('Labels set') };

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
      ...setTaskLabelsResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(setTaskLabelsSchema),
  async (c): Promise<Returned<typeof setTaskLabelsResponses>> => {
    const { id } = c.req.valid('param');
    const { label_ids } = c.req.valid('json');
    const db = c.get('db');

    const actorId = c.get('user').id;
    const project = await assertTaskWrite(db, actorId, id);

    const desired = dedupe(label_ids);
    await assertLabelsInProject(db, desired, project.id);

    let removal = db.deleteFrom('task_label').where('task_label.task_id', '=', id);
    if (desired.length > 0) {
      removal = removal.where('task_label.label_id', 'not in', desired);
    }
    // `do nothing` returns no row for a pair that was already there, so
    // `returning` yields the exact added and removed sets.
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

const setTaskAssigneesResponses = { 204: emptyResponse('Assignees set') };

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
      ...setTaskAssigneesResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(setTaskAssigneesSchema),
  async (c): Promise<Returned<typeof setTaskAssigneesResponses>> => {
    const { id } = c.req.valid('param');
    const { user_ids } = c.req.valid('json');
    const db = c.get('db');

    const actor = c.get('user');
    const actorId = actor.id;
    const project = await assertTaskWrite(db, actorId, id);

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

    // Only the additions: echoing the current set is not a new assignment.
    await notify(c, {
      kind: 'task_assigned',
      actor,
      project,
      taskId: id,
      recipientUserIds: added,
    });

    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
    return c.body(null, 204);
  }
);

const setTaskCoverResponses = { 204: emptyResponse('Cover set or cleared') };

router.put(
  '/:id/cover',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Set task cover image',
    description:
      'Choose which of the task’s images is shown on the board card face, or send a null ' +
      'image_id to clear it. The image must belong to the task; violations return 422 with a ' +
      'plain error body. Setting a cover replaces any previous one — a task has at most one ' +
      'cover — and clearing an absent cover is an idempotent 204. The cover is a choice about ' +
      'presentation, not content, so it leaves updated_at untouched.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...setTaskCoverResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(setTaskCoverSchema),
  async (c): Promise<Returned<typeof setTaskCoverResponses>> => {
    const { id } = c.req.valid('param');
    const { image_id } = c.req.valid('json');
    const db = c.get('db');

    const project = await assertTaskWrite(db, c.get('user').id, id);

    // Serializes cover writes per task: under READ COMMITTED the clear below
    // only sees committed rows, so a concurrent set would survive a clear that
    // answered 204 and published a payload disagreeing with the stored row.
    const target = await db
      .selectFrom('task')
      .select('task.id')
      .where('task.id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!target) {
      throw new AppError(404, 'Task not found');
    }

    if (image_id !== null) {
      const image = await db
        .selectFrom('task_attachment')
        .select('task_attachment.task_id')
        .where('task_attachment.id', '=', image_id)
        .where('task_attachment.kind', '=', IMAGE_KIND)
        .executeTakeFirst();
      if (!image || image.task_id !== id) {
        throw new AppError(422, 'image_id must reference an image on this task');
      }
    }

    try {
      await setTaskCoverImage(db, id, image_id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Cover image changed concurrently; retry');
      }
      throw err;
    }

    const updated = await fetchBoardTask(db, id);
    if (!updated) {
      throw new AppError(500, 'Failed to load the updated task');
    }
    publishAfterCommit(c, 'task_updated', project.id, updated.task);

    return c.body(null, 204);
  }
);

const addBlockerResponses = { 204: emptyResponse('Blocker added (or already present)') };

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
      ...addBlockerResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...dependencyCycleErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(addBlockerSchema),
  async (c): Promise<Returned<typeof addBlockerResponses>> => {
    const { id } = c.req.valid('param');
    const { blocker_task_id } = c.req.valid('json');
    const db = c.get('db');

    const actorId = c.get('user').id;
    const project = await assertTaskWrite(db, actorId, id);

    if (blocker_task_id === id) {
      throw new AppError(422, 'A task cannot block itself');
    }

    // The access filter rides in the same query as the lookup, so "no such task"
    // and "not yours to see" are one absent row rather than two branches someone
    // could later give two different answers. Read access is enough: the edge
    // mutates the blocked task, not this one.
    const blocker = await db
      .selectFrom('task')
      .innerJoin('project', 'project.id', 'task.project_id')
      .select(['task.project_id', 'task.archived_at', 'task.title'])
      .where('task.id', '=', blocker_task_id)
      .where(accessibleProjectsFilter(actorId))
      .executeTakeFirst();
    if (!blocker) {
      throw new AppError(422, BLOCKER_UNREACHABLE);
    }
    // Ordered after the access check, so this narrower answer only ever reaches
    // someone who can already read the card.
    //
    // Board reads hide archived blockers, so allowing this would hand the task
    // an edge no client could ever display or remove.
    if (blocker.archived_at !== null) {
      throw new AppError(422, 'blocker_task_id must not reference an archived task');
    }

    await lockDependencyProjects(db, [project.id, blocker.project_id]);
    if (await wouldCreateDependencyCycle(db, id, blocker_task_id)) {
      const cycle = await findDependencyCyclePath(db, actorId, id, blocker_task_id);
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
          newValue: {
            id: blocker_task_id,
            // This entry is read by everyone who can see the blocked task, who
            // need no relation to the blocker's project. A blank name is what
            // the activity feed renders as "a task in another project".
            name: blocker.project_id === project.id ? blocker.title : '',
          },
        },
      ]);
    }

    await refreshCrossProjectBlockerCounts(db, [id]);
    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
    return c.body(null, 204);
  }
);

const removeBlockerResponses = { 204: emptyResponse('Blocker removed (or already absent)') };

router.delete(
  '/:id/blockers/:blockerTaskId',
  describeRoute({
    tags: ['Tasks'],
    summary: 'Remove a blocker',
    description: 'Remove a dependency. Idempotent: removing an absent blocker still returns 204.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...removeBlockerResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(taskBlockerParamsSchema),
  async (c): Promise<Returned<typeof removeBlockerResponses>> => {
    const { id, blockerTaskId } = c.req.valid('param');
    const db = c.get('db');

    const actorId = c.get('user').id;
    // Write on the blocked side only, deliberately: an edge whose far end has
    // become inaccessible must still be detachable by the side that carries it.
    const project = await assertTaskWrite(db, actorId, id);

    const removed = await db
      .deleteFrom('task_dependency')
      .using('task')
      .whereRef('task.id', '=', 'task_dependency.blocker_task_id')
      .where('task_dependency.blocked_task_id', '=', id)
      .where('task_dependency.blocker_task_id', '=', blockerTaskId)
      .returning(['task_dependency.blocker_task_id', 'task.title', 'task.project_id'])
      .executeTakeFirst();

    if (removed) {
      await recordTaskActivity(db, actorId, [
        {
          taskId: id,
          kind: 'blocker_removed',
          oldValue: {
            id: removed.blocker_task_id,
            name: removed.project_id === project.id ? removed.title : '',
          },
        },
      ]);
    }

    await refreshCrossProjectBlockerCounts(db, [id]);
    publishTaskRelationsSet(c, await fetchTaskRelations(db, [id]));
    return c.body(null, 204);
  }
);

export default router;
