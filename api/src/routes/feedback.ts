import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { env } from '../config/env';
import { APP_NAME } from '../config/constants';
import { getEmailSender } from '../services/email/index';
import {
  createFeedbackSchema,
  feedbackResponseSchema,
  unauthorizedErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.post(
  '/',
  describeRoute({
    tags: ['Feedback'],
    summary: 'Send feedback',
    description:
      'Store product feedback from the signed-in user and email it to the site owner. ' +
      'The client supplies the feedback id.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Feedback stored',
        content: {
          'application/json': {
            schema: resolver(feedbackResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(createFeedbackSchema),
  async (c) => {
    const { id, message, page_path } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    let createdAt: Date;
    try {
      const row = await db
        .insertInto('feedback')
        .values({ id, user_id: user.id, message, page_path: page_path ?? null })
        .returning('created_at')
        .executeTakeFirstOrThrow();
      createdAt = row.created_at;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Feedback id already in use');
      }
      throw err;
    }

    c.get('postCommitHooks').push(() =>
      getEmailSender().send({
        to: env.feedbackEmailAddress,
        subject: `${APP_NAME} feedback from ${user.name} <${user.email}>`,
        text: `${message}\n\nPage: ${page_path ?? 'unknown'}\nUser id: ${user.id}`,
      })
    );

    return c.json({ id, created_at: createdAt.toISOString() }, 201);
  }
);

export default router;
