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
    try {
      await db.transaction().execute(async (trx) => {
        c.set('db', trx);
        await next();
        // Hono's compose catches handler throws at the handler's own dispatch
        // frame and builds the response via onError, so next() resolves even
        // for errors; rethrow c.error so Kysely rolls back instead of
        // committing writes made before the failure.
        if (c.error) {
          throw c.error;
        }
      });
    } catch (err) {
      if (err === c.error) {
        // onError already produced the response; rethrowing would run it twice.
        return;
      }
      throw err;
    }
  } else {
    c.set('db', db);
    await next();
    if (c.error) {
      return;
    }
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
