import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import {
  workspacesListResponseSchema,
  unauthorizedErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.get(
  '/',
  describeRoute({
    tags: ['Workspaces'],
    summary: 'List workspaces (deprecated)',
    description:
      'Deprecated: workspaces were replaced by per-project members. Always returns an empty ' +
      'list so stale clients degrade gracefully.',
    deprecated: true,
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Always an empty workspace list',
        content: {
          'application/json': {
            schema: resolver(workspacesListResponseSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  (c) => {
    return c.json({ workspaces: [] }, 200);
  }
);

export default router;
