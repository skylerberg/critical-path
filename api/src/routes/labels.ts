import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { jsonValidator } from '../middleware/jsonValidator';
import { paramValidator } from '../middleware/requestValidator';
import { AppError, isUniqueViolation } from '../utils/errors';
import { assertProjectWrite } from '../services/authorization';
import { assertLabelWrite, LABEL_NOT_FOUND } from '../services/labels';
import { publishAfterCommit } from '../services/realtime/index';
import { recordTaskActivity } from '../services/taskActivity';
import {
  createLabelSchema,
  patchLabelSchema,
  labelSchema,
  idSchema,
  jsonResponse,
  emptyResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  validationErrorResponse,
  validationOrUnprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

const createLabelResponses = { 201: jsonResponse('Label created', labelSchema) };

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
      ...createLabelResponses,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationOrUnprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  jsonValidator(createLabelSchema),
  async (c): Promise<Returned<typeof createLabelResponses>> => {
    const { id, project_id, name, color } = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    await assertProjectWrite(db, user.id, project_id);

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

const patchLabelResponses = { 200: jsonResponse('Updated label', labelSchema) };

router.patch(
  '/:id',
  describeRoute({
    tags: ['Labels'],
    summary: 'Update label',
    description: 'Rename or recolor a label. Label names are unique per project.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...patchLabelResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...validationErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  jsonValidator(patchLabelSchema),
  async (c): Promise<Returned<typeof patchLabelResponses>> => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.get('db');
    const user = c.get('user');

    const existing = await assertLabelWrite(db, user.id, id);

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
        throw new AppError(404, LABEL_NOT_FOUND);
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

const deleteLabelResponses = { 204: emptyResponse('Label deleted') };

router.delete(
  '/:id',
  describeRoute({
    tags: ['Labels'],
    summary: 'Delete label',
    description: 'Delete a label. Its task associations are removed by cascade.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...deleteLabelResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof deleteLabelResponses>> => {
    const { id } = c.req.valid('param');
    const db = c.get('db');
    const user = c.get('user');

    const label = await assertLabelWrite(db, user.id, id);

    // Read before the delete, which takes the associations with it by cascade.
    const attached = await db
      .selectFrom('task_label')
      .select('task_id')
      .where('label_id', '=', id)
      .execute();

    await db.deleteFrom('label').where('id', '=', id).execute();

    await recordTaskActivity(
      db,
      user.id,
      attached.map((row) => ({
        taskId: row.task_id,
        kind: 'label_removed' as const,
        oldValue: { id, name: label.name },
      }))
    );

    publishAfterCommit(c, 'label_deleted', label.project_id, { id });
    return c.body(null, 204);
  }
);

export default router;
