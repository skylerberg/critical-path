process.on('uncaughtException', (error) => {
  logger.error({
    msg: 'Uncaught exception',
    error: errorText(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error({
    msg: 'Unhandled rejection',
    error: errorText(reason),
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
import { deduplicateOpenAPISpec } from './spec/openapi-dedupe';
import { assertUniqueOperationIds } from './spec/openapi-assert-unique-operation-ids';
import { buildSchemaNameRegistry } from './spec/schema-registry';
import { env, assertEmailConfig, assertProxyConfig } from './config/env';
import { APP_NAME } from './config/constants';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware, skipAuth } from './middleware/auth';
import { transactionMiddleware } from './middleware/transaction';
import { assertPublicRoutes } from './utils/assert-public-routes';
import { Variables } from './types/index';
import { db } from './db/index';
import { attachRealtime, initRedisBus, closeRedisBus } from './services/realtime/index';
import { buildRealtimeEventsDocument } from './spec/realtime-events';
import { closeRedis } from './services/redis';
import { startJobWorker } from './services/jobs/index';
import { registerJobHandlers } from './services/jobs/register';
import { startWebhookWorker } from './services/webhooks/index';
import { errorText } from './utils/errors';
import { startupFailureMessage } from './utils/serverStartup';
import { logger } from './utils/logger';

import authRouter, { publicAuthRouter } from './routes/auth';
import avatarUploadRouter from './routes/avatarUpload';
import avatarsRouter from './routes/avatars';
import usersRouter from './routes/users';
import projectsRouter from './routes/projects';
import invitationsRouter from './routes/invitations';
import columnsRouter from './routes/columns';
import tasksRouter from './routes/tasks';
import taskBulkRouter from './routes/taskBulk';
import myTasksRouter from './routes/myTasks';
import searchRouter from './routes/search';
import labelsRouter from './routes/labels';
import commentsRouter from './routes/comments';
import checklistItemsRouter from './routes/checklistItems';
import { publicImagesRouter } from './routes/images';
import attachmentsRouter, { publicAttachmentsRouter } from './routes/attachments';
import feedbackRouter from './routes/feedback';
import publicBoardsRouter from './routes/publicBoards';
import webhooksRouter from './routes/webhooks';
import taskSeriesRouter from './routes/taskSeries';

export const app = new Hono<{ Variables: Variables }>();

app.use('*', secureHeaders());
app.use('*', corsMiddleware);
app.use('*', compress());

const AVATAR_UPLOAD_PATH = '/api/auth/me/avatar';
const ATTACHMENT_UPLOAD_PATH = '/api/attachments/files';
const globalBodyLimit = bodyLimit({
  maxSize: 1024 * 1024,
  onError: (c) => c.json({ error: 'Payload too large' }, 413),
});
// The upload routes carry their own larger bodyLimit; a global cap applied
// first would reject those uploads before the route-level limit runs.
app.use('*', (c, next) => {
  if (
    c.req.method === 'POST' &&
    (c.req.path === AVATAR_UPLOAD_PATH || c.req.path === ATTACHMENT_UPLOAD_PATH)
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

// Authentication is the default, not something each route opts into: a handler
// that forgets it cannot exist. The routes that genuinely serve without a token
// carry the `skipAuth` marker, and `assertPublicRoutes` below pins that set.
app.use('*', authMiddleware);

const healthCheck = async (c: Context) => {
  try {
    await sql`select 1`.execute(db);
    return c.json({ status: 'healthy' });
  } catch {
    return c.json({ status: 'unhealthy' }, 503);
  }
};

app.get('/health', skipAuth, healthCheck);
app.get('/', skipAuth, healthCheck);

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
          description:
            'Opaque session token from signup or login, or a personal access token (cpat_…) ' +
            'from POST /api/auth/tokens',
        },
      },
    },
    tags: [
      {
        name: 'Auth',
        description: 'Signup, login, session management, and personal access tokens',
      },
      { name: 'Users', description: 'Visible users' },
      { name: 'Projects', description: 'Projects, members, and board payloads' },
      { name: 'Columns', description: 'Kanban board columns' },
      { name: 'Tasks', description: 'Tasks, dependencies, labels, and assignees' },
      { name: 'Search', description: 'Cross-project task search' },
      { name: 'Labels', description: 'Per-project labels' },
      { name: 'Comments', description: 'Task comment threads' },
      { name: 'Checklists', description: 'Card checklist items' },
      { name: 'Images', description: 'Task image upload and retrieval' },
      { name: 'Attachments', description: 'Task file and link attachments' },
      { name: 'Avatars', description: 'User profile image upload and retrieval' },
      { name: 'Feedback', description: 'User-submitted product feedback' },
      { name: 'Webhooks', description: 'Per-project outbound HTTP callbacks' },
      { name: 'Recurring', description: 'Recurring task series' },
      { name: 'Public', description: 'Unauthenticated read-only board access' },
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

app.get('/api/openapi.json', skipAuth, async (c) => {
  return c.json(await buildOpenApiSpec());
});

// Beside the spec rather than in it: /ws carries no HTTP request or response, so
// the socket and webhook envelopes need their own document. Serving it is what
// lets a client generate event types against a deployed API instead of needing a
// checkout of this repo.
app.get('/api/realtime-events.json', skipAuth, async (c) => {
  return c.json(await buildRealtimeEventsDocument());
});

app.get('/api/docs', skipAuth, swaggerUI({ url: '/api/openapi.json' }));

app.route('/api/auth', publicAuthRouter);
app.route('/api/auth', authRouter);
// Second router on the same prefix: POST /me/avatar needs its own bodyLimit.
app.route('/api/auth', avatarUploadRouter);
app.route('/api/users', usersRouter);
app.route('/api/projects', projectsRouter);
app.route('/api/invitations', invitationsRouter);
app.route('/api/columns', columnsRouter);
app.route('/api/tasks', tasksRouter);
// Second router on the same prefix: POST /:id/images needs its own bodyLimit.
// Third: every path it adds is single-segment, so mount order cannot shadow it.
app.route('/api/tasks', taskBulkRouter);
app.route('/api/my-tasks', myTasksRouter);
app.route('/api/search', searchRouter);
app.route('/api/labels', labelsRouter);
app.route('/api/comments', commentsRouter);
app.route('/api/checklist-items', checklistItemsRouter);
app.route('/api/images', publicImagesRouter);
app.route('/api/attachments', publicAttachmentsRouter);
app.route('/api/attachments', attachmentsRouter);
app.route('/api/avatars', avatarsRouter);
app.route('/api/feedback', feedbackRouter);
app.route('/api/webhooks', webhooksRouter);
app.route('/api/task-series', taskSeriesRouter);
app.route('/api/public', publicBoardsRouter);

assertPublicRoutes(app.routes);
assertProxyConfig();
assertEmailConfig();

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

  server.on('error', (error: NodeJS.ErrnoException) => {
    logger.error({ msg: startupFailureMessage(error, PORT), error: errorText(error) });
    process.exit(1);
  });

  const realtime = attachRealtime(server);
  const webhookWorker = startWebhookWorker();
  registerJobHandlers();
  const jobWorker = startJobWorker();

  initRedisBus().catch((err: unknown) => {
    logger.error({
      msg: 'Redis bus init failed; realtime stays in-process',
      error: errorText(err),
    });
  });

  const shutdown = async (signal: string) => {
    logger.info({ msg: `${signal} signal received: closing HTTP server` });
    setTimeout(() => process.exit(1), 10_000).unref();
    realtime.close();
    webhookWorker.close();
    jobWorker.close();
    closeRedisBus();
    closeRedis();
    server.close();
    await db.destroy();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
