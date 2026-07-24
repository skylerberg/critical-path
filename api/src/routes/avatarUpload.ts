import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { describeRoute, resolver } from 'hono-openapi';
import sharp from 'sharp';
import { authMiddleware } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { avatarUrl } from '../services/avatars';
import { sniffImageContentType } from '../services/imageSniff';
import { storage } from '../services/storage/index';
import { logger } from '../utils/logger';
import {
  userSchema,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  payloadTooLargeErrorResponse,
  unprocessableErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const AVATAR_MAX_DIMENSION = 1024;

const router: AppHono = new Hono();

router.post(
  '/me/avatar',
  describeRoute({
    tags: ['Avatars'],
    summary: 'Upload avatar',
    description:
      'Set the profile image of the authenticated user via multipart form data. The upload ' +
      'must sniff as PNG, JPEG, GIF, or WebP by magic bytes (the client-declared MIME type ' +
      'is ignored) and be at most 10 MB. The image is normalized server-side: auto-oriented, ' +
      'downscaled to fit within 1024x1024 (never enlarged), and re-encoded as WebP. Animated ' +
      'GIF/WebP uploads keep only their first frame. Replaces any existing avatar; the old ' +
      'stored object is deleted after the transaction commits.',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              file: { type: 'string', format: 'binary' },
            },
            required: ['file'],
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated user',
        content: {
          'application/json': {
            schema: resolver(userSchema),
          },
        },
      },
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
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
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new AppError(400, 'file is required');
    }

    if (file.size > MAX_FILE_BYTES) {
      throw new AppError(413, 'File exceeds the 10 MB limit');
    }

    const data = Buffer.from(await file.arrayBuffer());
    if (!sniffImageContentType(data)) {
      throw new AppError(422, 'Unsupported image type; allowed formats: PNG, JPEG, GIF, WebP');
    }

    let normalized: Buffer;
    try {
      // Without the pixel cap a kilobyte-sized bomb decodes to gigabytes and OOMs the pod.
      normalized = await sharp(data, { autoOrient: true, limitInputPixels: 32_000_000 })
        .resize(AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp()
        .toBuffer();
    } catch {
      throw new AppError(422, 'Could not process image');
    }

    const storageKey = crypto.randomUUID();
    await storage.put(storageKey, normalized, 'image/webp');

    let previousKey: string | null;
    try {
      const row = await db
        .selectFrom('app_user')
        .select('avatar_storage_key')
        .where('id', '=', user.id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      previousKey = row.avatar_storage_key;

      await db
        .updateTable('app_user')
        .set({ avatar_storage_key: storageKey, avatar_content_type: 'image/webp' })
        .where('id', '=', user.id)
        .execute();
    } catch (err) {
      // Intentionally not cleaned up: an orphaned object is acceptable.
      logger.warn({
        msg: 'Orphaned storage object: avatar row update failed after storage write',
        storageKey,
        userId: user.id,
      });
      throw err;
    }

    if (previousKey !== null) {
      const oldKey = previousKey;
      c.get('postCommitHooks').push(() => storage.delete(oldKey));
    }

    return c.json(
      { id: user.id, email: user.email, name: user.name, avatar_url: avatarUrl(storageKey) },
      200
    );
  }
);

router.delete(
  '/me/avatar',
  describeRoute({
    tags: ['Avatars'],
    summary: 'Remove avatar',
    description:
      'Remove the profile image of the authenticated user. The stored object is deleted ' +
      'after the transaction commits. Idempotent: removing a nonexistent avatar succeeds. ' +
      'Returns the updated user so clients can adopt it directly.',
    security: [{ bearerAuth: [] }],
    responses: {
      200: {
        description: 'Updated user',
        content: {
          'application/json': {
            schema: resolver(userSchema),
          },
        },
      },
      ...unauthorizedErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  authMiddleware,
  async (c) => {
    const db = c.get('db');
    const user = c.get('user');

    const row = await db
      .selectFrom('app_user')
      .select('avatar_storage_key')
      .where('id', '=', user.id)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (row.avatar_storage_key !== null) {
      const oldKey = row.avatar_storage_key;
      await db
        .updateTable('app_user')
        .set({ avatar_storage_key: null, avatar_content_type: null })
        .where('id', '=', user.id)
        .execute();
      c.get('postCommitHooks').push(() => storage.delete(oldKey));
    }

    return c.json({ id: user.id, email: user.email, name: user.name, avatar_url: null }, 200);
  }
);

export default router;
