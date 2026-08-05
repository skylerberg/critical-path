import { describe, it, expect } from 'vitest';
import type { RouterRoute } from 'hono/types';
import { app } from '../../src/index';
import { skipAuth } from '../../src/middleware/auth';
import { assertPublicRoutes } from '../../src/utils/assert-public-routes';

const LOGIN = '/api/auth/login';

function routes(): RouterRoute[] {
  return app.routes.map((route) => ({ ...route }));
}

describe('assertPublicRoutes', () => {
  it('accepts the routes the app registers', () => {
    expect(() => {
      assertPublicRoutes(app.routes);
    }).not.toThrow();
  });

  it('rejects a route that serves without a token but is not listed as public', () => {
    const smuggled: RouterRoute[] = [
      ...routes(),
      { basePath: '/', path: '/api/projects', method: 'DELETE', handler: skipAuth },
    ];
    expect(() => {
      assertPublicRoutes(smuggled);
    }).toThrow(/not listed as public[\s\S]*DELETE \/api\/projects/);
  });

  it('rejects a listed route that lost its marker and would start demanding a token', () => {
    const unmarked = routes().filter(
      (route) => !(route.path === LOGIN && route.handler === skipAuth)
    );
    expect(() => {
      assertPublicRoutes(unmarked);
    }).toThrow(/carry no skipAuth marker/);
  });

  it('rejects a listed route that no longer exists', () => {
    const removed = routes().filter((route) => route.path !== LOGIN);
    expect(() => {
      assertPublicRoutes(removed);
    }).toThrow(/no longer exist/);
  });
});
