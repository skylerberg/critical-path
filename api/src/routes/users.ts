import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { queryValidator } from '../middleware/requestValidator';
import { assertProjectAccess } from '../services/authorization';
import { avatarUrl } from '../services/avatars';
import { enforceUserSearchRateLimit } from '../services/rateLimit';
import {
  matchesEmailFilter,
  sharesProjectFilter,
  usersWithProjectAccess,
} from '../services/userDirectory';
import { searchUsersByName, USER_SEARCH_LIMIT } from '../services/userSearch';
import {
  usersQuerySchema,
  usersResponseSchema,
  userSearchQuerySchema,
  userSearchResponseSchema,
  jsonResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  tooManyRequestsErrorResponse,
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
      'missing or unreadable. A malformed address is 400. This route never reaches past ' +
      "the caller's own set; GET /api/users/search is the one that does.",
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

const searchUsersResponses = {
  200: jsonResponse('Matching users, ordered by name', userSearchResponseSchema),
};

router.get(
  '/search',
  describeRoute({
    tags: ['Users'],
    summary: 'Search all users by name',
    description:
      'Find people the caller does not already share a project with, so a board can be ' +
      'shared with someone by name rather than only by exact email address. Matching is by ' +
      'word prefix: every word in q must prefix some word of the name, in any order, so ' +
      '"sky" and "lo ada" find "Skyler Berg" and "Ada Lovelace" respectively. It is not a ' +
      'substring match — "kyler" finds nobody — and accents are not folded, so "jose" does ' +
      'not find "José". q is trimmed, and is 400 shorter than 2 characters or longer than ' +
      '100; a q that tokenizes to nothing at all matches nobody rather than erroring. ' +
      'Deliberately disjoint from GET /api/users: the caller and everyone already listed ' +
      'there are excluded, so the two can be shown as one list without deduplicating, and ' +
      `the ${USER_SEARCH_LIMIT}-result cap is never spent on people the client already ` +
      'holds. truncated reports that more matched than were returned; there is no ' +
      'pagination, because narrowing the query is the only intended way to see more. ' +
      'A user record is { id, name, avatar_url } here as everywhere — never an email ' +
      'address, and an address is not searchable. Metered per account and per source ' +
      'address, and 429 past either.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...searchUsersResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...tooManyRequestsErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(userSearchQuerySchema),
  async (c): Promise<Returned<typeof searchUsersResponses>> => {
    const { q } = c.req.valid('query');
    const user = c.get('user');

    await enforceUserSearchRateLimit(c, user.id);

    return c.json(await searchUsersByName(c.get('db'), user.id, q), 200);
  }
);

export default router;
