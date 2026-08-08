import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { queryValidator } from '../middleware/requestValidator';
import {
  assertProjectAccess,
  matchesEmailFilter,
  sharesProjectFilter,
  usersWithProjectAccess,
} from '../services/authorization';
import { avatarUrl } from '../services/avatars';
import {
  usersQuerySchema,
  usersResponseSchema,
  jsonResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const listUsersResponses = {
  200: jsonResponse('Visible users', usersResponseSchema),
};

router.get(
  '/',
  describeRoute({
    tags: ['Users'],
    summary: 'List visible users',
    description:
      'Without project_id, list the caller and every user sharing at least one project ' +
      'with them (as creator or member on either side). With project_id (the caller must ' +
      'have access to the project — 404 otherwise), list users who can access that project ' +
      'plus users still assigned to its tasks or still holding a comment on them. Ordered ' +
      'by name. email narrows either listing to the one user holding that exact address, ' +
      'case-insensitively, and is the only way to name someone by address: a user record ' +
      'never carries one. It selects from the same set the unfiltered call already returns ' +
      'in full, so it discloses nothing new — an address that belongs to nobody visible ' +
      'yields an empty list rather than 404, which on this route means the project is ' +
      'missing or unreadable. A malformed address is 400.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...listUsersResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(usersQuerySchema),
  async (c): Promise<Returned<typeof listUsersResponses>> => {
    const { project_id, email } = c.req.valid('query');
    const db = c.get('db');
    const user = c.get('user');

    if (project_id !== undefined) {
      await assertProjectAccess(db, user.id, project_id);
      const users = await usersWithProjectAccess(db, project_id, email);
      return c.json({ users }, 200);
    }

    const rows = await db
      .selectFrom('app_user')
      .select(['app_user.id', 'app_user.name', 'app_user.avatar_storage_key'])
      .where((eb) =>
        eb.and([
          ...(email === undefined ? [] : [matchesEmailFilter(email)(eb)]),
          eb.or([eb('app_user.id', '=', user.id), sharesProjectFilter(user.id)(eb)]),
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
