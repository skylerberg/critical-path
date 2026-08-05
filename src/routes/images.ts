import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { skipAuth } from '../middleware/auth';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { assertProjectWrite } from '../services/authorization';
import { publishAfterCommit } from '../services/realtime/index';
import { deleteTaskImage } from '../services/attachments/images';
import { storage } from '../services/storage/index';
import { storedObjectResponse } from '../services/storage/response';
import { logger } from '../utils/logger';
import {
  idSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  forbiddenErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono, PublicHono } from '../types/index';

const router: AppHono = new Hono();

// Serving bytes is unauthenticated, deleting is not, and the two cannot share a
// router: one Hono instance carries one context type, and the GET handler must
// not be told a user is present.
export const publicImagesRouter: PublicHono = new Hono();

publicImagesRouter.get(
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
  skipAuth,
  paramValidator(idSchema),
  async (c) => {
    const { id } = c.req.valid('param');

    // Selects the two image-only columns and never storage_key or content_type,
    // so this route stays structurally incapable of serving a file attachment's
    // bytes — a file row has both of these null and 404s here. That, rather than
    // a kind filter someone could drop, is what keeps an unauthenticated URL
    // from echoing an uploader-chosen content type over uploader-chosen bytes.
    const row = await c
      .get('db')
      .selectFrom('task_attachment')
      .select(['image_storage_key', 'image_content_type'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row || row.image_storage_key === null || row.image_content_type === null) {
      throw new AppError(404, 'Image not found');
    }

    const object = await storage.getStream(row.image_storage_key);
    if (!object) {
      logger.error({
        msg: 'Image row exists but storage object is missing',
        imageId: id,
        storageKey: row.image_storage_key,
      });
      throw new AppError(404, 'Image not found');
    }

    c.header('Content-Type', row.image_content_type);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return storedObjectResponse(c, object);
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
      ...forbiddenErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  paramValidator(idSchema),
  async (c) => {
    const db = c.get('db');
    const { id } = c.req.valid('param');

    const row = await db
      .selectFrom('task_attachment')
      .innerJoin('task', 'task.id', 'task_attachment.task_id')
      .select(['task_attachment.image_storage_key', 'task_attachment.task_id', 'task.project_id'])
      .where('task_attachment.id', '=', id)
      .where('task_attachment.kind', '=', 'image')
      .executeTakeFirst();
    if (!row || row.image_storage_key === null) {
      throw new AppError(404, 'Image not found');
    }
    const storageKey = row.image_storage_key;
    await assertProjectWrite(db, c.get('user').id, row.project_id, 'Image not found');

    await deleteTaskImage(db, id);
    c.get('postCommitHooks').push(() => storage.delete(storageKey));

    const { count } = await db
      .selectFrom('task_attachment')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('task_id', '=', row.task_id)
      .where('kind', '=', 'image')
      .executeTakeFirstOrThrow();
    const cover = await db
      .selectFrom('task_attachment')
      .select('task_attachment.id')
      .where('task_attachment.task_id', '=', row.task_id)
      .where('task_attachment.kind', '=', 'image')
      .where('task_attachment.is_cover', '=', true)
      .executeTakeFirst();
    publishAfterCommit(c, 'image_deleted', row.project_id, {
      task_id: row.task_id,
      image_count: Number(count),
      cover_image_url: cover === undefined ? null : `/api/images/${cover.id}`,
    });

    return c.body(null, 204);
  }
);

export default router;
