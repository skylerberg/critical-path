import { Context } from 'hono';
import { HTTPResponseError } from 'hono/types';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(err: Error | HTTPResponseError, c: Context) {
  const user = c.get('user') as { id: string } | undefined;
  const userId = user?.id;

  if (err instanceof AppError) {
    const log = err.statusCode >= 500 ? logger.error : logger.warn;
    log({
      msg: 'Request error',
      status: err.statusCode,
      error: err.message,
      stack: err.statusCode >= 500 ? err.stack : undefined,
      path: c.req.path,
      method: c.req.method,
      userId,
    });
    return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode);
  }

  logger.error({
    msg: 'Unexpected error',
    error: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
    userId,
  });

  // Never echo err.message: driver errors leak table and constraint names.
  return c.json({ error: 'An internal server error occurred. Please try again later.' }, 500);
}
