import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { assertProjectAccess } from '../services/authorization';
import { publishAfterCommit } from '../services/realtime/index';
import { storage } from '../services/storage/index';
import { logger } from '../utils/logger';
import {
  idSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.get(
  '/:id',
  describeRoute({
    tags: ['Images'],
    summary: 'Get image',
    description:
      'Serve image bytes with the Content-Type recorded at upload. Unauthenticated: the unguessable image id acts as a capability URL so <img> tags work without auth headers.',
    responses: {
      200: {
        description: 'Image bytes (Content-Type reflects the stored image format)',
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      },
      ...badRequestErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    const row = await c
      .get('db')
      .selectFrom('task_image')
      .select(['storage_key', 'content_type'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) {
      throw new AppError(404, 'Image not found');
    }

    const data = await storage.get(row.storage_key);
    if (!data) {
      logger.error({
        msg: 'Image row exists but storage object is missing',
        imageId: id,
        storageKey: row.storage_key,
      });
      throw new AppError(404, 'Image not found');
    }

    c.header('Content-Type', row.content_type);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(new Uint8Array(data), 200);
  }
);

router.delete(
  '/:id',
  describeRoute({
    tags: ['Images'],
    summary: 'Delete image',
    description: 'Delete an image row; the stored object is removed after the transaction commits.',
    security: [{ bearerAuth: [] }],
    responses: {
      204: {
        description: 'Image deleted',
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
    const db = c.get('db');
    const { id } = c.req.valid('param');

    const row = await db
      .selectFrom('task_image')
      .innerJoin('task', 'task.id', 'task_image.task_id')
      .select(['task_image.storage_key', 'task_image.task_id', 'task.project_id'])
      .where('task_image.id', '=', id)
      .executeTakeFirst();
    if (!row) {
      throw new AppError(404, 'Image not found');
    }
    await assertProjectAccess(db, c.get('user').id, row.project_id, 'Image not found');

    await db.deleteFrom('task_image').where('task_image.id', '=', id).execute();
    c.get('postCommitHooks').push(() => storage.delete(row.storage_key));

    const { count } = await db
      .selectFrom('task_image')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task_id', '=', row.task_id)
      .executeTakeFirstOrThrow();
    publishAfterCommit(c, 'image_deleted', row.project_id, {
      task_id: row.task_id,
      image_count: Number(count),
    });

    return c.body(null, 204);
  }
);

export default router;
