import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { assertPublicProject } from '../services/authorization';
import { getPublicBoard } from '../services/boardPayload';
import {
  idSchema,
  publicBoardSchema,
  badRequestErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.get(
  '/projects/:id/board',
  describeRoute({
    tags: ['Public'],
    summary: 'Get public board',
    description:
      'Serve a read-only board for a project whose is_public flag is set. Unauthenticated: ' +
      'anyone holding the project id can read it. The payload carries columns, labels, and ' +
      'tasks with their descriptions, labels, blockers, image counts, and assignee ids, plus ' +
      'the name and avatar of each assigned user. Member ids, the creator, timestamps, and ' +
      'email addresses are never included. Projects that are private, unknown, or deleted are ' +
      'all 404.',
    responses: {
      200: {
        description: 'Public board payload',
        content: {
          'application/json': {
            schema: resolver(publicBoardSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.get('db');

    await assertPublicProject(db, id);
    const payload = await getPublicBoard(db, id);
    if (!payload) {
      throw new AppError(404, 'This board is not public');
    }

    c.header('X-Robots-Tag', 'noindex, nofollow');
    return c.json(payload, 200);
  }
);

export default router;
