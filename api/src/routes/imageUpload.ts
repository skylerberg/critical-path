import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeRoute, resolver, validator } from 'hono-openapi';
import { authMiddleware } from '../middleware/auth';
import { AppError, isUniqueViolation } from '../utils/errors';
import { sniffImageContentType } from '../services/imageSniff';
import { storage } from '../services/storage/index';
import { logger } from '../utils/logger';
import { isValidUuid } from '../types/uuid';
import {
  idSchema,
  imageResponseSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  conflictErrorResponse,
  payloadTooLargeErrorResponse,
  unprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const router: AppHono = new Hono();

router.post(
  '/:id/images',
  describeRoute({
    tags: ['Images'],
    summary: 'Upload task image',
    description:
      'Attach an image to a task via multipart form data. The stored content type is determined solely by magic-byte sniffing (PNG, JPEG, GIF, or WebP); the client-declared MIME type is ignored. Maximum file size 10 MB. An optional `id` field supplies the image id (server-generated when omitted).',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary' },
              id: {
                type: 'string',
                format: 'uuid',
                description: 'Optional client-supplied image id',
              },
            },
            required: ['file'],
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Image uploaded',
        content: {
          'application/json': {
            schema: resolver(imageResponseSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...conflictErrorResponse,
      ...payloadTooLargeErrorResponse,
      ...unprocessableErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  bodyLimit({
    maxSize: 11 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Payload too large' }, 413),
  }),
  validator('param', idSchema),
  async (c) => {
    const db = c.get('db');
    const { id: taskId } = c.req.valid('param');

    const task = await db
      .selectFrom('task')
      .select('id')
      .where('id', '=', taskId)
      .executeTakeFirst();
    if (!task) {
      throw new AppError(404, 'Task not found');
    }

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new AppError(400, 'file is required');
    }

    const rawId = body['id'];
    let imageId: string;
    if (rawId === undefined) {
      imageId = crypto.randomUUID();
    } else if (typeof rawId === 'string' && isValidUuid(rawId)) {
      imageId = rawId.toLowerCase();
    } else {
      throw new AppError(422, 'id must be a valid UUID');
    }

    if (file.size > MAX_FILE_BYTES) {
      throw new AppError(413, 'File exceeds the 10 MB limit');
    }

    const data = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImageContentType(data);
    if (!contentType) {
      throw new AppError(422, 'Unsupported image type; allowed formats: PNG, JPEG, GIF, WebP');
    }

    const storageKey = crypto.randomUUID();
    await storage.put(storageKey, data, contentType);

    const filename = (file.name || 'upload').slice(0, 255);

    let createdAt: Date;
    try {
      const row = await db
        .insertInto('task_image')
        .values({
          id: imageId,
          task_id: taskId,
          storage_key: storageKey,
          filename,
          content_type: contentType,
          size_bytes: data.length,
        })
        .returning('created_at')
        .executeTakeFirstOrThrow();
      createdAt = row.created_at;
    } catch (err) {
      // Intentionally not cleaned up: an orphaned object is acceptable.
      logger.warn({
        msg: 'Orphaned storage object: image row insert failed after storage write',
        storageKey,
        taskId,
      });
      if (isUniqueViolation(err)) {
        throw new AppError(409, 'Image id already in use');
      }
      throw err;
    }

    return c.json(
      {
        id: imageId,
        url: `/api/images/${imageId}`,
        filename,
        content_type: contentType,
        size_bytes: data.length,
        created_at: createdAt.toISOString(),
      },
      201
    );
  }
);

export default router;
