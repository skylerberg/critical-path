import { describe, it, expect } from 'vitest';
import { deduplicateOpenAPISpec } from '../../src/utils/openapi-dedupe';

describe('deduplicateOpenAPISpec', () => {
  it('returns spec unchanged when no duplicate schemas', () => {
    const spec = {
      openapi: '3.0.0',
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = deduplicateOpenAPISpec(spec);
    const schemas = (result.components as Record<string, unknown>)?.schemas as
      | Record<string, unknown>
      | undefined;
    expect(schemas === undefined || Object.keys(schemas).length === 0).toBe(true);
  });

  it('extracts duplicate schemas to components/schemas with $ref replacement', () => {
    const duplicateSchema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
      },
    };

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { ...duplicateSchema },
                  },
                },
              },
            },
          },
        },
        '/b': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': {
                    schema: { ...duplicateSchema },
                  },
                },
              },
            },
          },
        },
      },
    };

    const result = deduplicateOpenAPISpec(spec);

    const components = result.components as Record<string, unknown>;
    expect(components).toBeDefined();
    const schemas = components.schemas as Record<string, unknown>;
    expect(Object.keys(schemas).length).toBeGreaterThan(0);

    const paths = result.paths as Record<
      string,
      Record<
        string,
        Record<string, Record<string, Record<string, Record<string, Record<string, unknown>>>>>
      >
    >;
    const schemaA = paths['/a'].get.responses['200'].content['application/json'].schema;
    expect(schemaA.$ref).toMatch(/^#\/components\/schemas\//);
  });

  it('preserves existing components.schemas', () => {
    const duplicateSchema = {
      type: 'object',
      properties: { x: { type: 'number' } },
    };

    const spec = {
      openapi: '3.0.0',
      components: {
        schemas: {
          ExistingSchema: { type: 'string' },
        },
      },
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { ...duplicateSchema } },
                },
              },
            },
          },
        },
        '/b': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { ...duplicateSchema } },
                },
              },
            },
          },
        },
      },
    };

    const result = deduplicateOpenAPISpec(spec);
    const schemas = (result.components as Record<string, Record<string, unknown>>).schemas;
    expect(schemas.ExistingSchema).toEqual({ type: 'string' });
    expect(Object.keys(schemas).length).toBeGreaterThan(1);
  });

  it('handles spec with no paths', () => {
    const spec = { openapi: '3.0.0' };
    const result = deduplicateOpenAPISpec(spec);
    expect(result.openapi).toBe('3.0.0');
  });

  it('does not mutate the original spec', () => {
    const duplicateSchema = {
      type: 'object',
      properties: { id: { type: 'string' } },
    };

    const spec = {
      openapi: '3.0.0',
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { ...duplicateSchema } },
                },
              },
            },
          },
        },
        '/b': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/json': { schema: { ...duplicateSchema } },
                },
              },
            },
          },
        },
      },
    };

    const original = JSON.stringify(spec);
    deduplicateOpenAPISpec(spec);
    expect(JSON.stringify(spec)).toBe(original);
  });
});
