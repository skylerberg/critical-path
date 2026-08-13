import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { queryValidator } from '../middleware/requestValidator';
import { getMyTasks, MY_TASKS_PAGE_SIZE } from '../services/myTasks';
import {
  myTasksQuerySchema,
  myTasksResponseSchema,
  jsonResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const getMyTasksResponses = {
  200: jsonResponse(
    'Assigned tasks with buckets and person-level dependency groups',
    myTasksResponseSchema
  ),
};

router.get(
  '/',
  describeRoute({
    tags: ['Tasks'],
    summary: 'List my tasks across projects',
    description:
      'List every unarchived, unfinished task assigned to the caller across all accessible, ' +
      'non-archived projects. Each task carries a bucket, fixed by the server: blocked (it has ' +
      'at least one unfinished blocker), blocking (someone else is assigned to a task it holds ' +
      'up), or ready. Tasks are ordered blocking, then ready, then blocked, and within a bucket ' +
      'by how many people are waiting, then project name and board position. Each task also ' +
      'carries its unfinished blockers and dependents with their assignees, plus ' +
      'waiting_user_ids: the other people whose unfinished work it blocks. The companion arrays ' +
      'group the same edges by person — waiting_on_you from the dependents, you_are_waiting_on ' +
      'from the blockers, which alone can carry an unassigned group, and both cover this page ' +
      `only. At most ${MY_TASKS_PAGE_SIZE} tasks come back per call; next_offset carries the ` +
      'offset that fetches the next page and is null on the last one. The ordering above is ' +
      'applied before the page is cut, so the first page holds the most urgent work rather ' +
      'than an arbitrary slice of it.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...getMyTasksResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  queryValidator(myTasksQuerySchema),
  async (c): Promise<Returned<typeof getMyTasksResponses>> => {
    const user = c.get('user');
    const { offset } = c.req.valid('query');
    return c.json(await getMyTasks(c.get('db'), user.id, offset), 200);
  }
);

export default router;
