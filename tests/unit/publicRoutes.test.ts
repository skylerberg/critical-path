import { describe, it, expect, afterEach, vi } from 'vitest';
import type { RouterRoute } from 'hono/types';
import { app } from '../../src/index';
import { optionalAuth, skipAuth } from '../../src/middleware/auth';
import { assertPublicRoutes } from '../../src/utils/assert-public-routes';

const LOGIN = '/api/auth/login';
const IMAGE = '/api/images/:id';

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

  it('rejects a listed optional-auth route that no longer exists', () => {
    const removed = routes().filter((route) => route.path !== '/api/attachments/:id/download');
    expect(() => {
      assertPublicRoutes(removed);
    }).toThrow(/optional-auth but no longer exist[\s\S]*GET \/api\/attachments\/:id\/download/);
  });

  it('rejects a route that serves anonymous callers but is not listed as optional-auth', () => {
    const smuggled: RouterRoute[] = [
      ...routes(),
      { basePath: '/', path: '/api/projects', method: 'DELETE', handler: optionalAuth },
    ];
    expect(() => {
      assertPublicRoutes(smuggled);
    }).toThrow(/not listed as optional-auth[\s\S]*DELETE \/api\/projects/);
  });

  it('rejects a listed optional-auth route that lost its marker', () => {
    const unmarked = routes().filter(
      (route) => !(route.path === IMAGE && route.handler === optionalAuth)
    );
    expect(() => {
      assertPublicRoutes(unmarked);
    }).toThrow(/optional-auth but carry no marker[\s\S]*GET \/api\/images\/:id/);
  });

  // The two sets are collected from two markers, and skipAuth is the stricter
  // one only by accident of naming: it serves a member as a stranger.
  it('does not take skipAuth as the optional-auth marker', () => {
    const swapped = routes().map((route) =>
      route.path === IMAGE && route.handler === optionalAuth
        ? { ...route, handler: skipAuth }
        : route
    );
    expect(() => {
      assertPublicRoutes(swapped);
    }).toThrow(/optional-auth but carry no marker[\s\S]*GET \/api\/images\/:id/);
    expect(() => {
      assertPublicRoutes(swapped);
    }).toThrow(/not listed as public[\s\S]*GET \/api\/images\/:id/);
  });
});

// assertProxyConfig and assertEmailConfig are exercised as functions in their own
// unit files; what only an import can answer is whether boot still runs them. A
// deploy with EMAIL_DRIVER=ses and no from address otherwise looks healthy and
// mails nothing, because every send runs in a post-commit hook that logs and moves on.
describe('src/index boot configuration', () => {
  const OVERRIDDEN = [
    'TRUST_PROXY',
    'EMAIL_DRIVER',
    'SES_FROM_ADDRESS',
    'SES_REGION',
    'AWS_REGION',
    'AWS_DEFAULT_REGION',
  ] as const;
  const originals = Object.fromEntries(OVERRIDDEN.map((name) => [name, process.env[name]]));

  afterEach(() => {
    for (const name of OVERRIDDEN) {
      const original = originals[name];
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
    vi.resetModules();
  });

  it('builds the app for a valid environment', async () => {
    vi.resetModules();
    const rebuilt = await import('../../src/index');
    expect(rebuilt.app.routes.length).toBe(app.routes.length);
  });

  it('refuses to build with a TRUST_PROXY that is neither true nor false', async () => {
    process.env.TRUST_PROXY = '1';
    vi.resetModules();
    await expect(import('../../src/index')).rejects.toThrow(
      /TRUST_PROXY must be "true" or "false"/
    );
  });

  it('refuses to build with EMAIL_DRIVER=ses and no from address', async () => {
    process.env.EMAIL_DRIVER = 'ses';
    delete process.env.SES_FROM_ADDRESS;
    process.env.SES_REGION = 'us-west-2';
    vi.resetModules();
    await expect(import('../../src/index')).rejects.toThrow(/SES_FROM_ADDRESS is required/);
  });
});
