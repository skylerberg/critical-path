import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import {
  createLabelSchema,
  patchLabelSchema,
  labelSchema,
  idSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.post(
  '/',
  describeRoute({
    tags: ['Labels'],
    summary: 'Create label',
    description:
      'Create a label in a project. The client supplies the label id. Label names are unique per project.',
    security: [{ bearerAuth: [] }],
    responses: {
      201: {
        description: 'Label created',
        content: {
          'application/json': {
            schema: resolver(labelSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  jsonValidator(createLabelSchema),
  async (c) => {
    const { id, project_id, name, color } = c.req.valid('json');
    const db = c.get('db');

    const project = await db
      .selectFrom('project')
      .select('id')
      .where('id', '=', project_id)
      .executeTakeFirst();
    if (!project) {
      throw new AppError(422, 'Project does not exist');
    }

    try {
      const label = await db
        .insertInto('label')
        .values({ id, project_id, name, color })
        .returningAll()
        .executeTakeFirstOrThrow();
      return c.json(label, 201);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Label id or name already in use');
      }
      throw err;
    }
  }
);

router.patch(
  '/:id',
  describeRoute({
    tags: ['Labels'],
    summary: 'Update label',
    description: 'Rename or recolor a label. Label names are unique per project.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated label',
        content: {
          'application/json': {
            schema: resolver(labelSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  jsonValidator(patchLabelSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');

    const updates: { name?: string; color?: string } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.color !== undefined) updates.color = body.color;

    if (Object.keys(updates).length === 0) {
      const label = await db
        .selectFrom('label')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!label) {
        throw new AppError(404, 'Label not found');
      }
      return c.json(label, 200);
    }

    try {
      const label = await db
        .updateTable('label')
        .set(updates)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!label) {
        throw new AppError(404, 'Label not found');
      }
      return c.json(label, 200);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Label name already in use in this project');
      }
      throw err;
    }
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Labels'],
    summary: 'Delete label',
    description: 'Delete a label. Its task associations are removed by cascade.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Label deleted',
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    const deleted = await c
      .get('db')
      .deleteFrom('label')
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!deleted) {
      throw new AppError(404, 'Label not found');
    }

    return c.body(null, 204);
  }
);

export default router;
