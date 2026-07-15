import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/index';
import type { Variables } from '../types/index';
import { logger } from '../utils/logger';

const TRANSACTIONAL_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Add as a no-op middleware on any route whose handler should NOT be wrapped
// in the automatic db.transaction(). Hono stores the middleware reference
// directly in the route record, so the same reference shows up in
// `c.req.matchedRoutes[i].handler` and transactionMiddleware below picks it
// up by identity — totally independent of the route's path, so renames and
// remounts carry the marker with them.
export const skipAutoTransaction: MiddlewareHandler = async (_c, next) => {
  await next();
};

export const transactionMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const hooks: Array<() => Promise<void>> = [];
  c.set('postCommitHooks', hooks);

  const skip = c.req.matchedRoutes.some((r) => r.handler === skipAutoTransaction);

  if (TRANSACTIONAL_METHODS.has(c.req.method) && !skip) {
    await db.transaction().execute(async (trx) => {
      c.set('db', trx);
      await next();
    });
  } else {
    c.set('db', db);
    await next();
  }

  for (const hook of hooks) {
    hook().catch((err) =>
      logger.error({
        msg: 'Post-commit hook failed',
        path: c.req.path,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
});
