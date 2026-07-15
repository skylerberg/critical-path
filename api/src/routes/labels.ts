import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertProjectAccess, canAccessProject } from '../services/authorization';
import { publishAfterCommit } from '../services/realtime/index';
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
      'Create a label in a project. The client supplies the label id. Label names are unique per ' +
      'project. Returns 404 when the referenced project is unknown or inaccessible.',
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
      ...notFoundErrorResponse,
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
    const user = c.get('user');

    const project = await db
      .selectFrom('project')
      .select(['created_by', 'workspace_id'])
      .where('id', '=', project_id)
      .executeTakeFirst();
    if (!project || !(await canAccessProject(db, user.id, project))) {
      throw new AppError(404, 'Project not found');
    }

    try {
      const label = await db
        .insertInto('label')
        .values({ id, project_id, name, color })
        .returningAll()
        .executeTakeFirstOrThrow();
      publishAfterCommit(c, 'label_created', project_id, label);
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
    const user = c.get('user');

    const existing = await db
      .selectFrom('label')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!existing) {
      throw new AppError(404, 'Label not found');
    }
    await assertProjectAccess(db, user.id, existing.project_id, 'Label not found');

    const updates: { name?: string; color?: string } = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.color !== undefined) updates.color = body.color;

    if (Object.keys(updates).length === 0) {
      return c.json(existing, 200);
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
      publishAfterCommit(c, 'label_updated', label.project_id, label);
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
    const db = c.get('db');
    const user = c.get('user');

    const label = await db
      .selectFrom('label')
      .select('project_id')
      .where('id', '=', id)
      .executeTakeFirst();
    if (!label) {
      throw new AppError(404, 'Label not found');
    }
    await assertProjectAccess(db, user.id, label.project_id, 'Label not found');

    await db.deleteFrom('label').where('id', '=', id).execute();

    publishAfterCommit(c, 'label_deleted', label.project_id, { id });
    return c.body(null, 204);
  }
);

export default router;
