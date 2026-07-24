process.on('uncaughtException', (error) => {
  logger.error({
    msg: 'Uncaught exception',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error({
    msg: 'Unhandled rejection',
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

import { serve } from '@hono/node-server';
import { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { secureHeaders } from 'hono/secure-headers';
import { sql } from 'kysely';
import { swaggerUI } from '@hono/swagger-ui';
import { generateSpecs } from 'hono-openapi';
import { deduplicateOpenAPISpec } from './utils/openapi-dedupe';
import { assertUniqueOperationIds } from './utils/openapi-assert-unique-operation-ids';
import { buildSchemaNameRegistry } from './utils/schema-registry';
import { env } from './config/env';
import { APP_NAME } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/errorHandler';
import { transactionMiddleware } from './middleware/transaction';
import { Variables } from './types/index';
import { db } from './db/index';
import { attachRealtime, initRedisBus, closeRedisBus } from './services/realtime/index';
import { closeRedis } from './services/redis';
import { logger } from './utils/logger';

import authRouter from './routes/auth';
import avatarUploadRouter from './routes/avatarUpload';
import avatarsRouter from './routes/avatars';
import usersRouter from './routes/users';
import workspacesRouter from './routes/workspaces';
import projectsRouter from './routes/projects';
import columnsRouter from './routes/columns';
import tasksRouter from './routes/tasks';
import imageUploadRouter from './routes/imageUpload';
import labelsRouter from './routes/labels';
import imagesRouter from './routes/images';
import feedbackRouter from './routes/feedback';

export const app = new Hono<{ Variables: Variables }>();

app.use('*', secureHeaders());
app.use('*', corsMiddleware);
app.use('*', compress());

const IMAGE_UPLOAD_PATH = /^\/api\/tasks\/[^/]+\/images$/;
const AVATAR_UPLOAD_PATH = '/api/auth/me/avatar';
const globalBodyLimit = bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => c.json({ error: 'Payload too large' }, 413),
});
// The upload routes carry their own larger bodyLimit; a global cap applied
// first would reject those uploads before the route-level limit runs.
app.use('*', (c, next) => {
  if (
    c.req.method === 'POST' &&
    (IMAGE_UPLOAD_PATH.test(c.req.path) || c.req.path === AVATAR_UPLOAD_PATH)
  ) {
    return next();
  }
  return globalBodyLimit(c, next);
});

// Image GET sets its own Cache-Control; don't clobber it.
app.use('*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) {
    c.header('Cache-Control', 'no-store');
  }
});

app.use('*', transactionMiddleware);

const healthCheck = async (c: Context) => {
  try {
    await sql`select 1`.execute(db);
    return c.json({ status: 'healthy' });
  } catch {
    return c.json({ status: 'unhealthy' }, 503);
  }
};

app.get('/health', healthCheck);
app.get('/', healthCheck);

const openAPIOptions = {
  documentation: {
    info: {
      title: `${APP_NAME} API`,
      version: '1.0.0',
      description: `TypeScript Hono API for ${APP_NAME} - a project management suite`,
    },
    servers: [{ url: `http://localhost:${env.port}`, description: 'Development' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http' as const,
          scheme: 'bearer',
          description: 'Opaque session token from signup or login',
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Signup, login, and session management' },
      { name: 'Users', description: 'Workspace users' },
      { name: 'Workspaces', description: 'Workspaces and their members' },
      { name: 'Projects', description: 'Projects and board payloads' },
      { name: 'Columns', description: 'Kanban board columns' },
      { name: 'Tasks', description: 'Tasks, dependencies, labels, and assignees' },
      { name: 'Labels', description: 'Per-project labels' },
      { name: 'Images', description: 'Task image upload and retrieval' },
      { name: 'Avatars', description: 'User profile image upload and retrieval' },
      { name: 'Feedback', description: 'User-submitted product feedback' },
    ],
  },
};

let schemaNameRegistryPromise: Promise<Map<string, string>> | null = null;

export async function buildOpenApiSpec(): Promise<Record<string, unknown>> {
  schemaNameRegistryPromise ??= buildSchemaNameRegistry();
  const [rawSpec, registry] = await Promise.all([
    generateSpecs(app, openAPIOptions),
    schemaNameRegistryPromise,
  ]);
  const dedupedSpec = deduplicateOpenAPISpec(rawSpec, registry);
  return assertUniqueOperationIds(dedupedSpec);
}

app.get('/api/openapi.json', async (c) => {
  return c.json(await buildOpenApiSpec());
});

app.get('/api/docs', swaggerUI({ url: '/api/openapi.json' }));

app.route('/api/auth', authRouter);
// Second router on the same prefix: POST /me/avatar needs its own bodyLimit.
app.route('/api/auth', avatarUploadRouter);
app.route('/api/users', usersRouter);
app.route('/api/workspaces', workspacesRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/columns', columnsRouter);
app.route('/api/tasks', tasksRouter);
// Second router on the same prefix: POST /:id/images needs its own bodyLimit.
app.route('/api/tasks', imageUploadRouter);
app.route('/api/labels', labelsRouter);
app.route('/api/images', imagesRouter);
app.route('/api/avatars', avatarsRouter);
app.route('/api/feedback', feedbackRouter);

app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      path: c.req.path,
    },
    404
  );
});

app.onError(errorHandler);

const isEntrypoint =
  !process.env.VITEST &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/src/index.ts') || process.argv[1].endsWith('/dist/index.mjs'));

if (isEntrypoint) {
  const PORT = env.port;
  const serverUrl =
    env.environment === 'production' ? `http://0.0.0.0:${PORT}` : `http://localhost:${PORT}`;

  const server = serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: '0.0.0.0',
    },
    () => {
      logger.info({ msg: `${APP_NAME} API | ${env.environment} | ${serverUrl}` });
      logger.info({ msg: `Docs at ${serverUrl}/api/docs` });
    }
  );

  const realtime = attachRealtime(server);

  initRedisBus().catch((err: unknown) => {
    logger.error({
      msg: 'Redis bus init failed; realtime stays in-process',
      error: err instanceof Error ? err.message : String(err),
    });
  });

  const shutdown = async (signal: string) => {
    logger.info({ msg: `${signal} signal received: closing HTTP server` });
    setTimeout(() => process.exit(1), 10_000).unref();
    realtime.close();
    closeRedisBus();
    closeRedis();
    server.close();
    await db.destroy();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
