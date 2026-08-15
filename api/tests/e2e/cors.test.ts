import { describe, it, expect, vi } from 'vitest';
import { app } from '../../src/index';
import { env } from '../../src/config/env';

const ALLOWED = 'http://localhost:5173';

async function get(origin?: string): Promise<Response> {
  return app.request('/health', {
    headers: origin === undefined ? {} : { Origin: origin },
  });
}

async function preflight(origin: string): Promise<Response> {
  return app.request('/api/projects', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
}

describe('CORS', () => {
  it('defaults the allowlist to the dev SPA origin', () => {
    expect(env.corsOrigins).toEqual([ALLOWED]);
  });

  it('trims and drops empty entries of a comma-separated list', async () => {
    process.env.CORS_ORIGINS = 'https://one.example, ,https://two.example ';
    vi.resetModules();
    try {
      const { env: reloaded } = await import('../../src/config/env');
      expect(reloaded.corsOrigins).toEqual(['https://one.example', 'https://two.example']);
    } finally {
      delete process.env.CORS_ORIGINS;
      vi.resetModules();
    }
  });

  it('echoes an allowed origin back and permits credentials', async () => {
    const res = await get(ALLOWED);

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toBe('Origin');
  });

  // The allowlist is matched whole. Each of these contains or extends the real
  // origin, which is what a prefix or suffix comparison would hand a stranger.
  it('sends no allow-origin header to an origin that is not on the list', async () => {
    for (const origin of [
      'http://localhost:5173.evil.example',
      'http://localhost:51730',
      'https://localhost:5173',
      'http://localhost:5173/',
      'http://evil.example',
      'null',
    ]) {
      const res = await get(origin);
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(null);
    }
  });

  it('sends no allow-origin header when the request carries no origin', async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(null);
  });

  it('answers a preflight from an allowed origin with the methods and headers the SPA uses', async () => {
    const res = await preflight(ALLOWED);

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('access-control-allow-methods')).toBe(
      'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    );
    expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type,Authorization');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });

  it('answers a preflight from an unlisted origin without allowing it', async () => {
    const res = await preflight('http://localhost:5173.evil.example');

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(null);
    expect(res.headers.get('access-control-allow-methods')).toBe(
      'GET,POST,PUT,PATCH,DELETE,OPTIONS'
    );
  });
});
