import { describe, it, expect } from 'vitest';
import { app } from '../../src/index';

describe('GET /api/openapi.json', () => {
  it('builds a spec containing the auth and users routes', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    expect(spec.openapi).toBeTypeOf('string');

    const paths = Object.keys(spec.paths);
    for (const expected of [
      '/api/auth/signup',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/users',
    ]) {
      expect(paths).toContain(expected);
    }

    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('has unique operationIds across all operations', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    const operationIds: string[] = [];
    for (const pathItem of Object.values(spec.paths) as Record<string, unknown>[]) {
      for (const operation of Object.values(pathItem)) {
        const operationId = (operation as { operationId?: string }).operationId;
        if (typeof operationId === 'string') {
          operationIds.push(operationId);
        }
      }
    }

    expect(operationIds.length).toBeGreaterThan(0);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
