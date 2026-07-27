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
      '/api/auth/tokens',
      '/api/auth/tokens/{id}',
      '/api/users',
      '/api/my-tasks',
    ]) {
      expect(paths).toContain(expected);
    }

    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('documents both 422 body shapes on routes with body validation plus domain rules', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    const ref = '#/components/schemas/ValidationOrUnprocessableError';
    expect(
      spec.paths['/api/tasks'].post.responses['422'].content['application/json'].schema
    ).toEqual({ $ref: ref });
    expect(
      spec.paths['/api/projects'].post.responses['422'].content['application/json'].schema
    ).toEqual({ $ref: ref });

    const union = spec.components.schemas.ValidationOrUnprocessableError;
    expect(Array.isArray(union.anyOf)).toBe(true);
    expect(union.anyOf).toHaveLength(2);
  });

  it('documents the cycle path on the add-blocker 409', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    expect(
      spec.paths['/api/tasks/{id}/blockers'].post.responses['409'].content['application/json']
        .schema
    ).toEqual({ $ref: '#/components/schemas/DependencyCycleError' });

    const conflict = spec.components.schemas.DependencyCycleError;
    expect(conflict.properties.error).toMatchObject({ type: 'string' });
    expect(conflict.properties.cycle).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/CycleTask' },
    });

    const step = spec.components.schemas.CycleTask;
    expect(step.properties.id).toMatchObject({ type: 'string' });
    expect(step.properties.title).toMatchObject({ type: 'string' });
  });

  it('documents the ownership-transfer route, its 403, and its request body', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    const operation = spec.paths['/api/projects/{id}/owner'].put;
    expect(operation.responses['403'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Error',
    });
    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/SetProjectOwner',
    });

    const body = spec.components.schemas.SetProjectOwner;
    expect(body.required).toEqual(['user_id']);
    expect(body.properties.user_id).toMatchObject({ type: 'string' });
  });

  it('marks the public board route unauthenticated and the private one authenticated', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    const publicOperation = spec.paths['/api/public/projects/{id}/board'].get;
    expect(publicOperation).toBeDefined();
    expect(publicOperation.security).toBeUndefined();
    expect(publicOperation.responses['401']).toBeUndefined();

    expect(spec.paths['/api/projects/{id}'].get.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents the project export route and its manifest schema', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    expect(Object.keys(spec.paths)).toContain('/api/projects/{id}/export');

    const content = spec.paths['/api/projects/{id}/export'].get.responses['200'].content;
    expect(Object.keys(content).sort()).toEqual(['application/json', 'application/zip']);
    expect(content['application/zip'].schema).toEqual({ type: 'string', format: 'binary' });
    expect(content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ProjectExport',
    });

    const manifest = spec.components.schemas.ProjectExport;
    expect(Object.keys(manifest.properties).sort()).toEqual([
      'columns',
      'exported_at',
      'format',
      'labels',
      'project',
      'tasks',
      'users',
      'version',
    ]);
    expect(Object.keys(manifest.properties.tasks.items.properties)).toContain('images');
    expect(Object.keys(manifest.properties.tasks.items.properties)).not.toContain('image_count');
  });

  it('documents the task activity route and its one-shape value schema', async () => {
    const res = await app.request('/api/openapi.json');
    expect(res.status).toBe(200);

    const spec = await res.json();
    expect(Object.keys(spec.paths)).toContain('/api/tasks/{id}/activity');
    expect(
      spec.paths['/api/tasks/{id}/activity'].get.responses['200'].content['application/json'].schema
    ).toEqual({ $ref: '#/components/schemas/TaskActivityResponse' });

    // A union here would make the generated clients unnarrowable, and arktype
    // refuses one that carries the Tiptap morph.
    const value = spec.components.schemas.ActivityValue;
    expect(value.type).toBe('object');
    expect(Object.keys(value.properties).sort()).toEqual(['doc', 'id', 'name', 'text']);
    expect(value.required).toBeUndefined();

    const entry = spec.components.schemas.TaskActivity;
    expect(entry.properties.kind.enum).toContain('archived');
    expect(entry.properties.kind.enum).toContain('restored');
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
