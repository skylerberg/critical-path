import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/types';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertTaskWrite } from '../services/authorization';
import { assertChecklistItemWrite, CHECKLIST_ITEM_NOT_FOUND } from '../services/checklistItems';
import { fetchBoardTaskRows } from '../services/boardPayload';
import { publishAfterCommit } from '../services/realtime/index';
import { appendKeys, resolveSortKey } from '../services/sortKey';
import { recordTaskActivity } from '../services/taskActivity';
import {
  idSchema,
  duplicateSchema,
  createChecklistItemSchema,
  patchChecklistItemSchema,
  checklistItemSchema,
  boardTaskSchema,
  jsonResponse,
  emptyResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  positionConflictErrorResponse,
  validationErrorResponse,
  internalServerErrorResponse,
  type ChecklistItemResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

interface ChecklistItemRow {
  id: string;
  task_id: string;
  text: string;
  checked: boolean;
  sort_key: string;
  created_at: Date;
  updated_at: Date;
}

interface ChecklistCounts {
  checklist_item_count: number;
  checklist_done_count: number;
}

function toResponse(row: ChecklistItemRow): ChecklistItemResponse {
  return {
    id: row.id,
    task_id: row.task_id,
    text: row.text,
    checked: row.checked,
    sort_key: row.sort_key,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function countsForTask(db: Kysely<DB>, taskId: string): Promise<ChecklistCounts> {
  const row = await db
    .selectFrom('checklist_item')
    .select((eb) => [
      eb.fn.countAll<string>().as('total'),
      sql<string>`count(*) filter (where ${eb.ref('checklist_item.checked')})`.as('done'),
    ])
    .where('checklist_item.task_id', '=', taskId)
    .executeTakeFirstOrThrow();
  return {
    checklist_item_count: Number(row.total),
    checklist_done_count: Number(row.done),
  };
}

const createChecklistItemResponses = {
  201: jsonResponse('Checklist item created', checklistItemSchema),
};

router.post(
  '/',
  describeRoute({
    tags: ['Checklists'],
    summary: 'Add a checklist item',
    description:
      'Append an item to a task’s checklist. The client supplies the item id and its position; ' +
      'a duplicate id returns 409. An unknown or inaccessible task returns 404 and a viewer ' +
      'returns 403. Items may be added to an archived task, the same as comments. The optional ' +
      'checked flag lets an already-ticked item be imported in one call.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...createChecklistItemResponses,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createChecklistItemSchema),
  async (c): Promise<Returned<typeof createChecklistItemResponses>> => {
    const { id, task_id, text, sort_key, checked } = c.req.valid('json');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const project = await assertTaskWrite(db, actorId, task_id);

    let row;
    try {
      row = await db
        .insertInto('checklist_item')
        .values({
          id,
          task_id,
          text,
          sort_key:
            sort_key === undefined
              ? (await appendKeys(db, 'checklist_item', task_id))[0]!
              : await resolveSortKey(db, 'checklist_item', task_id, sort_key),
          checked: checked ?? false,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Checklist item id already in use');
      }
      throw err;
    }

    await recordTaskActivity(db, actorId, [
      { taskId: task_id, kind: 'checklist_item_added', newValue: { text } },
    ]);

    const item = toResponse(row);
    publishAfterCommit(c, 'checklist_item_created', project.id, {
      ...item,
      ...(await countsForTask(db, task_id)),
    });
    return c.json(item, 201);
  }
);

const patchChecklistItemResponses = {
  200: jsonResponse('Updated checklist item', checklistItemSchema),
};

router.patch(
  '/:id',
  describeRoute({
    tags: ['Checklists'],
    summary: 'Update a checklist item',
    description:
      'Tick, untick, rename or reposition one item. Every field is optional and an empty body ' +
      'changes nothing. Renaming and ticking advance the item’s updated_at; a reposition leaves ' +
      'it alone and, unlike the other three, records no activity entry — a keyboard drag ' +
      'finalizes once per arrow press and would otherwise write one entry per press. The ' +
      'parent task’s updated_at is never touched by any checklist write, so a checklist edit ' +
      'cannot invalidate an open editor’s optimistic-concurrency precondition. A sort_key ' +
      'already taken on the task ranks the item immediately after the one holding it rather ' +
      'than failing, so the echoed sort_key is not always the one that was sent.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...patchChecklistItemResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...positionConflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchChecklistItemSchema),
  async (c): Promise<Returned<typeof patchChecklistItemResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const { task_id, project } = await assertChecklistItemWrite(db, actorId, id);

    const before = await db
      .selectFrom('checklist_item')
      .select(['checklist_item.text', 'checklist_item.checked'])
      .where('checklist_item.id', '=', id)
      .forNoKeyUpdate('checklist_item')
      .executeTakeFirst();
    if (!before) {
      throw new AppError(404, CHECKLIST_ITEM_NOT_FOUND);
    }

    const contentChanged =
      (body.text !== undefined && body.text !== before.text) ||
      (body.checked !== undefined && body.checked !== before.checked);

    const changes = {
      ...(body.text !== undefined ? { text: body.text } : {}),
      ...(body.checked !== undefined ? { checked: body.checked } : {}),
      ...(body.sort_key !== undefined
        ? { sort_key: await resolveSortKey(db, 'checklist_item', task_id, body.sort_key) }
        : {}),
      ...(contentChanged ? { updated_at: sql<Date>`now()` } : {}),
    };

    // Every field is optional and an empty body validates, so without this a `{}`
    // patch would compile to an UPDATE with an empty SET list.
    if (Object.keys(changes).length > 0) {
      try {
        await db
          .updateTable('checklist_item')
          .set(changes)
          .where('checklist_item.id', '=', id)
          .execute();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new AppError(409, 'That position was taken while the move was in flight');
        }
        throw err;
      }
    }

    if (body.text !== undefined && body.text !== before.text) {
      await recordTaskActivity(db, actorId, [
        {
          taskId: task_id,
          kind: 'checklist_item_renamed',
          oldValue: { text: before.text },
          newValue: { text: body.text },
        },
      ]);
    }
    if (body.checked !== undefined && body.checked !== before.checked) {
      await recordTaskActivity(db, actorId, [
        {
          taskId: task_id,
          kind: body.checked ? 'checklist_item_checked' : 'checklist_item_unchecked',
          newValue: { text: body.text ?? before.text },
        },
      ]);
    }

    const row = await db
      .selectFrom('checklist_item')
      .selectAll()
      .where('checklist_item.id', '=', id)
      .executeTakeFirst();
    if (!row) {
      throw new AppError(404, CHECKLIST_ITEM_NOT_FOUND);
    }

    const item = toResponse(row);
    publishAfterCommit(c, 'checklist_item_updated', project.id, {
      ...item,
      ...(await countsForTask(db, task_id)),
    });
    return c.json(item, 200);
  }
);

const deleteChecklistItemResponses = { 204: emptyResponse('Checklist item deleted') };

router.delete(
  '/:id',
  describeRoute({
    tags: ['Checklists'],
    summary: 'Delete a checklist item',
    description: 'Remove one item from a task’s checklist. Deleting it twice returns 404.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...deleteChecklistItemResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteChecklistItemResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const { task_id, project } = await assertChecklistItemWrite(db, actorId, id);

    const deleted = await db
      .deleteFrom('checklist_item')
      .where('checklist_item.id', '=', id)
      .returning('checklist_item.text')
      .executeTakeFirst();
    if (!deleted) {
      throw new AppError(404, CHECKLIST_ITEM_NOT_FOUND);
    }

    await recordTaskActivity(db, actorId, [
      { taskId: task_id, kind: 'checklist_item_removed', oldValue: { text: deleted.text } },
    ]);

    publishAfterCommit(c, 'checklist_item_deleted', project.id, {
      id,
      task_id,
      ...(await countsForTask(db, task_id)),
    });
    return c.body(null, 204);
  }
);

const promoteChecklistItemResponses = {
  201: jsonResponse('The new task, in board-payload shape', boardTaskSchema),
};

router.post(
  '/:id/promote',
  describeRoute({
    tags: ['Checklists'],
    summary: 'Convert a checklist item into a card',
    description:
      'Turn one item into a bare task in the parent’s column: its text becomes the title and ' +
      'nothing else is carried over — no labels, assignees, due date or dependency edge. The ' +
      'item is removed. The client supplies the new task id and its position; a duplicate id ' +
      'returns 409 and the item survives. Promoting the same item twice returns 404 the second ' +
      'time and creates exactly one card.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...promoteChecklistItemResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(duplicateSchema),
  async (c): Promise<Returned<typeof promoteChecklistItemResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const actorId = c.get('user').id;

    const { task_id, project } = await assertChecklistItemWrite(db, actorId, id);

    // Delete first: a second concurrent promote blocks on this row lock, then
    // matches nothing and answers 404 having created no card. Inserting first
    // would make two cards out of one item.
    const removed = await db
      .deleteFrom('checklist_item')
      .where('checklist_item.id', '=', id)
      .returning(['checklist_item.text', 'checklist_item.task_id'])
      .executeTakeFirst();
    if (!removed) {
      throw new AppError(404, CHECKLIST_ITEM_NOT_FOUND);
    }

    const parent = await db
      .selectFrom('task')
      .select(['task.column_id', 'task.project_id'])
      .where('task.id', '=', removed.task_id)
      .executeTakeFirst();
    if (!parent) {
      throw new AppError(404, CHECKLIST_ITEM_NOT_FOUND);
    }

    try {
      await db
        .insertInto('task')
        .values({
          id: body.id,
          project_id: parent.project_id,
          column_id: parent.column_id,
          title: removed.text,
          sort_key:
            body.sort_key === undefined
              ? (await appendKeys(db, 'task', parent.column_id))[0]!
              : await resolveSortKey(db, 'task', parent.column_id, body.sort_key),
        })
        .execute();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Task id already in use');
      }
      throw err;
    }

    await recordTaskActivity(db, actorId, [
      { taskId: body.id, kind: 'created', newValue: { text: removed.text } },
      {
        taskId: task_id,
        kind: 'checklist_item_promoted',
        oldValue: { text: removed.text },
        newValue: { id: body.id, name: removed.text },
      },
    ]);

    const created = (await fetchBoardTaskRows(db, [body.id]))[0];
    if (!created) {
      throw new AppError(500, 'Failed to load the promoted task');
    }

    publishAfterCommit(c, 'task_created', project.id, created.task);
    publishAfterCommit(c, 'checklist_item_deleted', project.id, {
      id,
      task_id,
      ...(await countsForTask(db, task_id)),
    });
    return c.json(created.task, 201);
  }
);

export default router;
