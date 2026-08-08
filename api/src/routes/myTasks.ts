import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { getMyTasks } from '../services/myTasks';
import {
  myTasksResponseSchema,
  jsonResponse,
  type Returned,
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
      'from the blockers, which alone can carry an unassigned group.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...getMyTasksResponses,
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  async (c): Promise<Returned<typeof getMyTasksResponses>> => {
    const user = c.get('user');
    return c.json(await getMyTasks(c.get('db'), user.id), 200);
  }
);

export default router;
