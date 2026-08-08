import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { skipAuth } from '../middleware/auth';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { getPublicBoard } from '../services/boardPayload';
import {
  idSchema,
  publicBoardSchema,
  jsonResponse,
  type Returned,
  badRequestErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { PublicHono } from '../types/index';

const router: PublicHono = new Hono();

const getPublicBoardResponses = {
  200: jsonResponse('Public board payload', publicBoardSchema),
};

router.get(
  '/projects/:id/board',
  describeRoute({
    tags: ['Public'],
    summary: 'Get public board',
    description:
      'Serve a read-only board for a project whose is_public flag is set. Unauthenticated: ' +
      'anyone holding the project id can read it. The payload carries columns, labels, and ' +
      'tasks with their descriptions, due dates, labels, blockers, image counts, comment ' +
      'counts, and assignee ids, plus every comment on those tasks and the name and avatar of ' +
      'each user who is assigned one or wrote one. Comments on archived tasks are not served. ' +
      'Member ids, the creator, task timestamps, and the activity log are never included. ' +
      'Projects that are private, unknown, or deleted are all 404.',
    responses: {
      ...getPublicBoardResponses,
      ...badRequestErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  skipAuth,
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof getPublicBoardResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    const payload = await getPublicBoard(db, id);
    if (!payload) {
      throw new AppError(404, 'This board is not public');
    }

    c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.json(payload, 200);
  }
);

export default router;
