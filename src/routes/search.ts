import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { queryValidator } from '../middleware/requestValidator';
import { SEARCH_RESULT_LIMIT, searchTasks } from '../services/search';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  searchQuerySchema,
  searchResponseSchema,
  jsonResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const searchTasksResponses = {
  200: jsonResponse('Matching tasks, most relevant first', searchResponseSchema),
};

router.get(
  '/',
  describeRoute({
    tags: ['Search'],
    summary: 'Search tasks across projects',
    description:
      'Search task titles and description text across every non-archived project the caller ' +
      'can access; projects they cannot access simply do not appear. Archived cards are ' +
      `excluded. q is trimmed and must be ${SEARCH_QUERY_MIN_LENGTH} to ` +
      `${SEARCH_QUERY_MAX_LENGTH} characters. Every word in q must match, and each word ` +
      'matches as a prefix of an indexed word, so typing more of a word narrows the results ' +
      'rather than emptying them; the exception is a partially typed inflection that has ' +
      'outgrown the indexed word, which drops out until it is finished (a card titled "Fix ' +
      'the login test" matches test and testing but not testi). Mentions match on the name ' +
      `they display. Ranked with title matches above description matches, capped at ` +
      `${SEARCH_RESULT_LIMIT} results with truncated set when more matched.`,
    security: [{ bearerAuth: [] }],
    responses: {
      ...searchTasksResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(searchQuerySchema),
  async (c): Promise<Returned<typeof searchTasksResponses>> => {
    const { q } = c.req.valid('query');
    const user = c.get('user');
    return c.json(await searchTasks(c.get('db'), user.id, q), 200);
  }
);

export default router;
