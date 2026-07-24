import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { queryValidator } from '../middleware/requestValidator';
import { assertProjectAccess, usersWithProjectAccess } from '../services/authorization';
import { avatarUrl } from '../services/avatars';
import {
  usersQuerySchema,
  usersResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.get(
  '/',
  describeRoute({
    tags: ['Users'],
    summary: 'List visible users',
    description:
      'Without project_id, list the caller and every user sharing at least one workspace ' +
      'with them. With project_id (the caller must have access to the project — 404 ' +
      'otherwise), list users who can access that project plus users still assigned to its ' +
      'tasks. Ordered by name.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Visible users',
        content: {
          'application/json': {
            schema: resolver(usersResponseSchema),
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
  queryValidator(usersQuerySchema),
  async (c) => {
    const { project_id } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    if (project_id !== undefined) {
      await assertProjectAccess(db, user.id, project_id);
      const users = await usersWithProjectAccess(db, project_id);
      return c.json({ users }, 200);
    }

    const rows = await db
      .selectFrom('app_user')
      .select(['app_user.id', 'app_user.email', 'app_user.name', 'app_user.avatar_storage_key'])
      .where((eb) =>
        eb.or([
          eb('app_user.id', '=', user.id),
          eb.exists(
            eb
              .selectFrom('workspace_member as mine')
              .innerJoin('workspace_member as theirs', 'theirs.workspace_id', 'mine.workspace_id')
              .select('theirs.user_id')
              .where('mine.user_id', '=', user.id)
              .whereRef('theirs.user_id', '=', 'app_user.id')
          ),
        ])
      )
      .orderBy('app_user.name')
      .orderBy('app_user.id')
      .execute();

    const users = rows.map(({ avatar_storage_key, ...rest }) => ({
      ...rest,
      avatar_url: avatarUrl(avatar_storage_key),
    }));
    return c.json({ users }, 200);
  }
);

export default router;
