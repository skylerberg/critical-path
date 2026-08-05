import type { RouterRoute } from 'hono/types';
import { skipAuth } from '../middleware/auth';

// Every route that serves without a token, decided once. The marker is what the
// runtime honours and this list is what pins it: a route that gains the marker
// without being listed fails at boot instead of quietly serving unauthenticated,
// and a listed route that loses it fails too rather than 401ing in production.
const PUBLIC_ROUTES: ReadonlySet<string> = new Set([
  'GET /',
  'GET /health',
  'GET /api/openapi.json',
  'GET /api/docs',
  'POST /api/auth/signup',
  'POST /api/auth/login',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
  'POST /api/auth/verify-email',
  'POST /api/auth/unsubscribe',
  'POST /api/auth/unsubscribe/all',
  'POST /api/auth/unsubscribe/one-click',
  'GET /api/avatars/:id',
  'GET /api/images/:id',
  'GET /api/attachments/:id/preview',
  'GET /api/attachments/:id/favicon',
  'GET /api/public/projects/:id/board',
]);

export function assertPublicRoutes(routes: RouterRoute[]): void {
  const registered = new Set<string>();
  const marked = new Set<string>();

  for (const route of routes) {
    if (route.method === 'ALL') continue;
    const key = `${route.method} ${route.path}`;
    registered.add(key);
    if (route.handler === skipAuth) {
      marked.add(key);
    }
  }

  const unlisted = [...marked].filter((key) => !PUBLIC_ROUTES.has(key)).sort();
  const unmarked = [...PUBLIC_ROUTES].filter((key) => registered.has(key) && !marked.has(key));
  const absent = [...PUBLIC_ROUTES].filter((key) => !registered.has(key));

  const problems = [
    unlisted.length > 0 &&
      `serve without authentication but are not listed as public:\n  ${unlisted.join('\n  ')}`,
    unmarked.length > 0 &&
      `are listed as public but carry no skipAuth marker, so they now require a token:\n  ${unmarked.sort().join('\n  ')}`,
    absent.length > 0 &&
      `are listed as public but no longer exist:\n  ${absent.sort().join('\n  ')}`,
  ].filter((problem): problem is string => problem !== false);

  if (problems.length > 0) {
    throw new Error(
      `Public route set does not match the code. These routes ${problems.join('\n\nThese routes ')}`
    );
  }
}
