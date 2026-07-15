import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import {
  usersResponseSchema,
  unauthorizedErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.get(
  '/',
  describeRoute({
    tags: ['Users'],
    summary: 'List users',
    description: 'List all users in the workspace, ordered by name.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'All users',
        content: {
          'application/json': {
            schema: resolver(usersResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  async (c) => {
    const users = await c
      .get('db')
      .selectFrom('app_user')
      .select(['id', 'email', 'name'])
      .orderBy('name')
      .orderBy('id')
      .execute();

    return c.json({ users }, 200);
  }
);

export default router;
