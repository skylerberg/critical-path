import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { optionalAuth } from '../middleware/auth';
import { paramValidator } from '../middleware/requestValidator';
import { AppError } from '../utils/errors';
import { storage } from '../services/storage/index';
import { storedObjectResponse } from '../services/storage/response';
import { assertAvatarReadable } from '../services/avatars';
import { logger } from '../utils/logger';
import {
  idSchema,
  rawResponse,
  type Returned,
  badRequestErrorResponse,
  unauthorizedErrorResponse,
  notFoundErrorResponse,
  internalServerErrorResponse,
} from '../schemas/index';
import { PublicHono } from '../types/index';

const router: PublicHono = new Hono();

const getAvatarResponses = {
  200: rawResponse({
    description: 'Avatar bytes (Content-Type reflects the stored image format)',
    content: {
      'application/octet-stream': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  }),
};

router.get(
  '/:id',
  describeRoute({
    tags: ['Avatars'],
    summary: 'Get avatar',
    description:
      'Serve avatar image bytes by storage key. Answers any signed-in caller — an avatar is ' +
      'the same key on every board its owner appears on — and an anonymous one only when its ' +
      'owner appears on a published board. A browser authenticates with the session cookie, ' +
      'since an <img> tag cannot carry an Authorization header. Every avatar upload mints a ' +
      'fresh key, so responses are immutable and cacheable forever.',
    security: [{ bearerAuth: [] }],
    responses: {
      ...getAvatarResponses,
      ...badRequestErrorResponse,
      ...unauthorizedErrorResponse,
      ...notFoundErrorResponse,
      ...internalServerErrorResponse,
    },
  }),
  optionalAuth,
  paramValidator(idSchema),
  async (c): Promise<Returned<typeof getAvatarResponses>> => {
    const { id } = c.req.valid('param');

    await assertAvatarReadable(c.get('db'), c.get('user'), id);

    const row = await c
      .get('db')
      .selectFrom('app_user')
      .select('avatar_content_type')
      .where('avatar_storage_key', '=', id)
      .executeTakeFirst();
    if (!row || row.avatar_content_type === null) {
      throw new AppError(404, 'Avatar not found');
    }

    const object = await storage.getStream(id);
    if (!object) {
      logger.error({
        msg: 'Avatar column set but storage object is missing',
        storageKey: id,
      });
      throw new AppError(404, 'Avatar not found');
    }

    c.header('Content-Type', row.avatar_content_type);
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    return storedObjectResponse(c, object);
  }
);

export default router;
