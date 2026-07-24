import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { storage } from '../services/storage/index';
import { logger } from '../utils/logger';
import {
  idSchema,
  badRequestErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { AppHono } from '../types/index';

const router: AppHono = new Hono();

router.get(
  '/:id',
  describeRoute({
    tags: ['Avatars'],
    summary: 'Get avatar',
    description:
      'Serve avatar image bytes by storage key. Unauthenticated: the unguessable key acts ' +
      'as a capability URL so <img> tags work without auth headers. Every avatar upload ' +
      'mints a fresh key, so responses are immutable and cacheable forever.',
    responses: {
      200: {
        description: 'Avatar bytes (Content-Type reflects the stored image format)',
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
      .selectFrom('app_user')
      .select('avatar_content_type')
      .where('avatar_storage_key', '=', id)
      .executeTakeFirst();
    if (!row || row.avatar_content_type === null) {
      throw new AppError(404, 'Avatar not found');
    }

    const data = await storage.get(id);
    if (!data) {
      logger.error({
        msg: 'Avatar column set but storage object is missing',
        storageKey: id,
      });
      throw new AppError(404, 'Avatar not found');
    }

    c.header('Content-Type', row.avatar_content_type);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return c.body(new Uint8Array(data), 200);
  }
);

export default router;
