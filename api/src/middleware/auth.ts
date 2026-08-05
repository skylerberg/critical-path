import { Next } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { matchedRoutes } from 'hono/route';
import { PublicContext } from '../types/index';
import { AppError } from '../utils/errors';
import { db } from '../db/index';
import { avatarUrl } from '../services/avatars';
import { authenticateBearerToken } from '../services/credentials';

const BEARER_PREFIX = 'Bearer ';

// The one parser of the prefix: a second one silently strips the wrong length.
export function bearerToken(c: Pick<PublicContext, 'req'>): string | null {
  const header = c.req.header('Authorization');
  return header?.startsWith(BEARER_PREFIX) === true ? header.slice(BEARER_PREFIX.length) : null;
}

// Add as a no-op middleware on any route that must serve without a token.
// Picked up by identity out of matchedRoutes, the same way skipAutoTransaction
// is, so renames and remounts carry it. Only ever added to one route at a time:
// as a `use('*')` on a sub-router it would match every sibling route sharing
// that mount prefix, and /api/auth and /api/attachments each host public and
// authenticated routes together. `assertPublicRoutes` pins the resulting set.
export const skipAuth: MiddlewareHandler = async (_c, next) => {
  await next();
};

export async function authMiddleware(c: PublicContext, next: Next) {
  if (matchedRoutes(c).some((route) => route.handler === skipAuth)) {
    return await next();
  }

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
