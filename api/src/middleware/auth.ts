import { Next } from 'hono';
import { AppContext } from '../types/index';
import { AppError } from '../utils/errors';
import { db } from '../db/index';
import { avatarUrl } from '../services/avatars';
import { hashSessionToken } from '../services/sessions';

export async function authMiddleware(c: AppContext, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError(401, 'No token provided');
  }

  const token = authHeader.substring(7);
  const tokenHash = hashSessionToken(token);
  const dbc = c.get('db') ?? db;

  const row = await dbc
    .selectFrom('session')
    .innerJoin('app_user', 'app_user.id', 'session.user_id')
    .select([
      'session.id as session_id',
      'session.expires_at',
      'app_user.id',
      'app_user.email',
      'app_user.name',
      'app_user.avatar_storage_key',
    ])
    .where('session.token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row) {
    throw new AppError(401, 'Invalid or expired token');
  }

  if (row.expires_at.getTime() <= Date.now()) {
    // Best-effort: rolled back if a surrounding transaction aborts on the 401.
    await dbc.deleteFrom('session').where('session.id', '=', row.session_id).execute();
    throw new AppError(401, 'Invalid or expired token');
  }

  c.set('user', {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar_url: avatarUrl(row.avatar_storage_key),
  });

  return await next();
}
