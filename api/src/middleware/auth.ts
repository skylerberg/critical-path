import { Next } from 'hono';
import { AppContext } from '../types/index';
import { AppError } from '../utils/errors';
import { db } from '../db/index';
import { avatarUrl } from '../services/avatars';
import { authenticateBearerToken } from '../services/credentials';

export async function authMiddleware(c: AppContext, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'No token provided');
  }

  const credential = await authenticateBearerToken(c.get('db') ?? db, authHeader.substring(7));

  if (!credential) {
    throw new AppError(401, 'Invalid or expired token');
  }

  c.set('user', {
    id: credential.user.id,
    email: credential.user.email,
    name: credential.user.name,
    avatar_url: avatarUrl(credential.user.avatar_storage_key),
  });

  return await next();
}
