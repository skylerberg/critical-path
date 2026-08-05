import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { sql, type Kysely, type Selectable } from 'kysely';
import type { DB, Project } from '../db/types';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertProjectAccess, assertTaskAccess } from '../services/authorization';
import { collectMentionIds, notifyMentions } from '../services/mentions';
import { publishAfterCommit } from '../services/realtime/index';
import {
  idSchema,
  createCommentSchema,
  patchCommentSchema,
  commentSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
  type CommentResponse,
  type TiptapDoc,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

interface CommentRow {
  id: string;
  task_id: string;
  user_id: string;
  body: unknown;
  created_at: Date;
  updated_at: Date;
}

function toResponse(row: CommentRow): CommentResponse {
  return {
    id: row.id,
    task_id: row.task_id,
    user_id: row.user_id,
    body: row.body as TiptapDoc,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function countForTask(db: Kysely<DB>, taskId: string): Promise<number> {
  const { count } = await db
    .selectFrom('task_comment')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('task_comment.task_id', '=', taskId)
    .executeTakeFirstOrThrow();
  return Number(count);
}

// Edit and delete are author-only; another member's comment answers 404 rather
// than 403 so the response cannot confirm it exists.
async function assertOwnComment(
  db: Kysely<DB>,
  userId: string,
  commentId: string
): Promise<{ task_id: string; project: Selectable<Project> }> {
  const row = await db
    .selectFrom('task_comment')
    .innerJoin('task', 'task.id', 'task_comment.task_id')
    .select(['task_comment.task_id', 'task_comment.user_id', 'task.project_id'])
    .where('task_comment.id', '=', commentId)
    .executeTakeFirst();
  if (!row) {
    throw new AppError(404, 'Comment not found');
  }
  const project = await assertProjectAccess(db, userId, row.project_id, 'Comment not found');
  if (row.user_id !== userId) {
    throw new AppError(404, 'Comment not found');
  }
  return { task_id: row.task_id, project };
}

// Only a body that carries a mention can have added one, so an edit that
// mentions nobody never pays for the comparison. It takes the lock the UPDATE
// will take anyway, so two concurrent patches cannot both see the pre-edit body
// and resolve the same mention twice.
async function bodyBeforeMentionEdit(
  db: Kysely<DB>,
  commentId: string,
  next: TiptapDoc
): Promise<unknown> {
  if (collectMentionIds(next).length === 0) {
    return null;
  }
  const row = await db
    .selectFrom('task_comment')
    .select('task_comment.body')
    .where('task_comment.id', '=', commentId)
    .forNoKeyUpdate('task_comment')
    .executeTakeFirst();
  return row?.body ?? null;
}

router.post(
  '/',
  describeRoute({
    tags: ['Comments'],
    summary: 'Create comment',
    description:
      'Post a comment on a task. The client supplies the comment id and the body is the same ' +
      'restricted Tiptap document task descriptions use; a body with no text, image, rule, or ' +
      'mention is rejected. Returns 404 when the task is unknown or inaccessible.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Comment created',
        content: {
          'application/json': {
            schema: resolver(commentSchema),
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
  jsonValidator(createCommentSchema),
  async (c) => {
    const { id, task_id, body } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const project = await assertTaskAccess(db, user.id, task_id);

    let row;
    try {
      row = await db
        .insertInto('task_comment')
        .values({ id, task_id, user_id: user.id, body: JSON.stringify(body) })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Comment id already in use');
      }
      throw err;
    }

    await notifyMentions(c, {
      actorUserId: user.id,
      project,
      taskId: task_id,
      source: 'comment',
      previous: null,
      next: body,
    });

    const comment = toResponse(row);
    publishAfterCommit(c, 'comment_created', project.id, {
      ...comment,
      comment_count: await countForTask(db, task_id),
    });
    return c.json(comment, 201);
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Comments'],
    summary: 'Update comment',
    description:
      'Replace the body of your own comment. A comment written by anyone else answers 404, ' +
      'the same as one that does not exist.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated comment',
        content: {
          'application/json': {
            schema: resolver(commentSchema),
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
  paramValidator(idSchema),
  jsonValidator(patchCommentSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const { body } = c.req.valid('json');
    const db = c.get('db');

    const user = c.get('user');
    const { task_id, project } = await assertOwnComment(db, user.id, id);

    const previousBody = await bodyBeforeMentionEdit(db, id, body);

    const row = await db
      .updateTable('task_comment')
      .set({ body: JSON.stringify(body), updated_at: sql<Date>`now()` })
      .where('task_comment.id', '=', id)
      .returningAll()
      .executeTakeFirst();
    // The row can still vanish between the ownership check and this update.
    if (!row) {
      throw new AppError(404, 'Comment not found');
    }

    await notifyMentions(c, {
      actorUserId: user.id,
      project,
      taskId: task_id,
      source: 'comment',
      previous: previousBody,
      next: body,
    });

    const comment = toResponse(row);
    publishAfterCommit(c, 'comment_updated', project.id, comment);
    return c.json(comment, 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Comments'],
    summary: 'Delete comment',
    description:
      'Delete your own comment. A comment written by anyone else answers 404, the same as one ' +
      'that does not exist.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Comment deleted',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    const { task_id, project } = await assertOwnComment(db, c.get('user').id, id);

    await db.deleteFrom('task_comment').where('task_comment.id', '=', id).execute();

    publishAfterCommit(c, 'comment_deleted', project.id, {
      id,
      task_id,
      comment_count: await countForTask(db, task_id),
    });
    return c.body(null, 204);
  }
);

export default router;
