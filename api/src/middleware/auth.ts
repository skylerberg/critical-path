import { Next } from 'hono';
import { AppContext } from '../types/index';
import { AppError } from '../utils/errors';
import { db } from '../db/index';
import { avatarUrl } from '../services/avatars';
import { authenticateBearerToken } from '../services/credentials';

const BEARER_PREFIX = 'Bearer ';

// The one parser of the prefix: a second one silently strips the wrong length.
export function bearerToken(c: Pick<AppContext, 'req'>): string | null {
  const header = c.req.header('Authorization');
  return header?.startsWith(BEARER_PREFIX) === true ? header.slice(BEARER_PREFIX.length) : null;
}

export async function authMiddleware(c: AppContext, next: Next) {
  const token = bearerToken(c);

  if (token === null) {
    throw new AppError(401, 'No token provided');
  }

  const credential = await authenticateBearerToken(c.get('db') ?? db, token);

  if (!credential) {
    throw new AppError(401, 'Invalid or expired token');
  }

  c.set('user', {
    id: credential.user.id,
    email: credential.user.email,
    name: credential.user.name,
    avatar_url: avatarUrl(credential.user.avatar_storage_key),
    email_verified: credential.user.email_verified_at !== null,
  });

  return await next();
}
