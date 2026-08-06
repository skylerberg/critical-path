import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { skipAuth } from '../middleware/auth';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { storage } from '../services/storage/index';
import { storedObjectResponse } from '../services/storage/response';
import { logger } from '../utils/logger';
import {
  idSchema,
  badRequestErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { PublicHono } from '../types/index';

// Only serving is left here: uploading goes through POST /api/attachments/files
// and deleting through DELETE /api/attachments/:id. This route survives them
// because /api/images/<uuid> is embedded in every description and comment body
// that holds a picture, so the URL has to keep resolving.
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
    // The type is sniffed and CHECK-constrained to four image formats, but a
    // file can be a valid GIF *and* valid HTML at once. nosniff is what stops a
    // browser looking past the declared type and rendering the other half as a
    // document on our own origin, from a URL that needs no credentials.
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return storedObjectResponse(c, object);
  }
);
