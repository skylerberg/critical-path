import { createMiddleware } from 'hono/factory';
import { db } from '../db/index';
import type { Variables } from '../types/index';
import { logger } from '../utils/logger';
import { errorText } from '../utils/errors';

const TRANSACTIONAL_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const transactionMiddleware = createMiddleware<{ Variables: Variables }>(async (c, next) => {
  const hooks: Array<() => Promise<void>> = [];
  c.set('postCommitHooks', hooks);
  c.set('webhookEvents', []);
  c.set('changedProjectIds', new Set());

  if (TRANSACTIONAL_METHODS.has(c.req.method)) {
    try {
      await db.transaction().execute(async (trx) => {
        c.set('db', trx);
        await next();
        // Hono's compose catches handler throws and builds the response via
        // onError, so next() resolves even for errors; rethrow c.error so
        // Kysely rolls back instead of committing writes made before it.
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

  const logHookFailure = (err: unknown) =>
    logger.error({
      msg: 'Post-commit hook failed',
      path: c.req.path,
      error: errorText(err),
    });

  for (const hook of hooks) {
    // A hook that throws before returning its promise never reaches .catch, and
    // would escape the loop to turn an already-committed response into a 500 —
    // `() => getEmailSender().send(...)` does exactly that for a bad EMAIL_DRIVER.
    try {
      hook().catch(logHookFailure);
    } catch (err) {
      logHookFailure(err);
    }
  }
});
