import { describe, it, expect } from 'vitest';
import { app } from '../../src/index';
import type { JsonBody } from '../setup/testContext';

async function fetchSpec(): Promise<JsonBody> {
  const res = await app.request('/api/openapi.json');
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/openapi.json', () => {
  it('builds a spec containing the auth and users routes', async () => {
    const spec = await fetchSpec();
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
      '/api/search',
      '/api/webhooks',
      '/api/webhooks/{id}',
      '/api/webhooks/{id}/rotate-secret',
      '/api/webhooks/{id}/deliveries',
      '/api/webhooks/{id}/deliveries/{deliveryId}/redeliver',
    ]) {
      expect(paths).toContain(expected);
    }

    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('documents both 422 body shapes on routes with body validation plus domain rules', async () => {
    const spec = await fetchSpec();
    const ref = '#/components/schemas/ValidationOrUnprocessableError';
    expect(
      spec.paths['/api/tasks'].post.responses['422'].content['application/json'].schema
    ).toEqual({ $ref: ref });
    expect(
      spec.paths['/api/tasks/batch'].post.responses['422'].content['application/json'].schema
    ).toEqual({ $ref: ref });
    expect(
      spec.paths['/api/projects'].post.responses['422'].content['application/json'].schema
    ).toEqual({ $ref: ref });

    const union = spec.components.schemas.ValidationOrUnprocessableError;
    expect(Array.isArray(union.anyOf)).toBe(true);
    expect(union.anyOf).toHaveLength(2);
  });

  it('documents the cycle path on the add-blocker 409', async () => {
    const spec = await fetchSpec();
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
    // Nullable on both: a loop may now pass through a project the caller
    // cannot read, and those steps are reported without naming anything.
    expect(step.properties.id).toMatchObject({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(step.properties.title).toMatchObject({ anyOf: [{ type: 'string' }, { type: 'null' }] });
  });

  it('documents account deletion with a request body and a structured 409', async () => {
    const spec = await fetchSpec();
    const operation = spec.paths['/api/auth/me'].delete;
    expect(Object.keys(operation.responses).sort()).toEqual(['204', '401', '409', '422', '500']);
    expect(operation.requestBody.content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DeleteAccount',
    });
    expect(operation.responses['409'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/DeleteAccountConflict',
    });

    const body = spec.components.schemas.DeleteAccount;
    expect(body.required).toEqual(['password']);
    expect(body.properties.password).toMatchObject({ type: 'string' });

    const conflict = spec.components.schemas.DeleteAccountConflict;
    expect(conflict.properties.error).toMatchObject({ type: 'string' });
    expect(conflict.properties.blocking_projects).toMatchObject({ type: 'array' });
  });

  it('documents the ownership-transfer route, its 403, and its request body', async () => {
    const spec = await fetchSpec();
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

  it('documents the owner-only 403 on project deletion', async () => {
    const spec = await fetchSpec();
    const operation = spec.paths['/api/projects/{id}'].delete;
    expect(operation.responses['403'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/Error',
    });
    expect(operation.responses['404']).toBeDefined();
  });

  it('marks the public board route unauthenticated and the private one authenticated', async () => {
    const spec = await fetchSpec();
    const publicOperation = spec.paths['/api/public/projects/{id}/board'].get;
    expect(publicOperation).toBeDefined();
    expect(publicOperation.security).toBeUndefined();
    expect(publicOperation.responses['401']).toBeUndefined();

    expect(spec.paths['/api/projects/{id}'].get.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents the project export route and its manifest schema', async () => {
    const spec = await fetchSpec();
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
    expect(Object.keys(manifest.properties.tasks.items.properties)).toContain('attachments');
    expect(Object.keys(manifest.properties.tasks.items.properties)).not.toContain('images');
    expect(Object.keys(manifest.properties.tasks.items.properties)).not.toContain('image_count');
  });

  it('documents the task activity route and its one-shape value schema', async () => {
    const spec = await fetchSpec();
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

  it('leaves the webhook delivery payload untyped so clients can read the envelope', async () => {
    const spec = await fetchSpec();
    expect(
      spec.paths['/api/webhooks/{id}/deliveries'].get.responses['200'].content['application/json']
        .schema
    ).toEqual({ $ref: '#/components/schemas/WebhookDeliveriesResponse' });

    // `object` would generate as Record<string, never> on the web side.
    const delivery = spec.components.schemas.WebhookDelivery;
    expect(delivery.properties.payload).toEqual({});
    expect(delivery.required).toContain('payload');
  });

  it('has unique operationIds across all operations', async () => {
    const spec = await fetchSpec();
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
