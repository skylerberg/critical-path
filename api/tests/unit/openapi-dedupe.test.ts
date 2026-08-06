import crypto from 'crypto';
import { describe, it, expect } from 'vitest';
import { deduplicateOpenAPISpec } from '../../src/utils/openapi-dedupe';

type Json = Record<string, unknown>;

function specWithRepeatedSchema(schema: Json, paths = ['/a', '/b']): Json {
  return {
    openapi: '3.0.0',
    paths: Object.fromEntries(
      paths.map((p) => [
        p,
        {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: structuredClone(schema) } } },
            },
          },
        },
      ])
    ),
  };
}

function schemaAt(result: Json, path: string): Json {
  const paths = result.paths as Record<string, Json>;
  const get = paths[path].get as Json;
  const responses = get.responses as Record<string, Json>;
  const content = responses['200'].content as Record<string, Json>;
  return content['application/json'].schema as Json;
}

function liftedNames(result: Json): string[] {
  const components = (result.components ?? {}) as Json;
  return Object.keys((components.schemas ?? {}) as Json);
}

function hashOf(schema: Json): string {
  return crypto.createHash('md5').update(JSON.stringify(schema)).digest('hex');
}

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

  describe('unions of bare scalars', () => {
    const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

    it('leaves a repeated nullable string inline instead of naming it after a path', () => {
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(nullableString));

      expect(liftedNames(result)).toEqual([]);
      expect(schemaAt(result, '/a')).toEqual(nullableString);
      expect(schemaAt(result, '/b')).toEqual(nullableString);
    });

    it('leaves a repeated nullable scalar inline even when it carries a format', () => {
      const nullableUuid = { anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] };
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(nullableUuid));

      expect(liftedNames(result)).toEqual([]);
      expect(schemaAt(result, '/a')).toEqual(nullableUuid);
    });

    it('inlines them inside a lifted object rather than cross-referencing', () => {
      const wrapper = {
        type: 'object',
        properties: { avatar_url: structuredClone(nullableString) },
      };
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(wrapper));

      const names = liftedNames(result);
      expect(names).toHaveLength(1);
      const lifted = ((result.components as Json).schemas as Json)[names[0]] as Json;
      expect((lifted.properties as Json).avatar_url).toEqual(nullableString);
    });

    it('still lifts a repeated union whose members are constants', () => {
      const enumUnion = {
        anyOf: [{ const: 'ok' }, { const: 'failed' }, { type: 'null' }],
      };
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(enumUnion));

      expect(liftedNames(result)).toHaveLength(1);
      expect(schemaAt(result, '/a').$ref).toMatch(/^#\/components\/schemas\//);
    });

    it('still lifts a repeated union that references a named schema', () => {
      const refUnion = {
        anyOf: [{ $ref: '#/components/schemas/TiptapDoc' }, { type: 'null' }],
      };
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(refUnion));

      expect(liftedNames(result)).toHaveLength(1);
      expect(schemaAt(result, '/a').$ref).toMatch(/^#\/components\/schemas\//);
    });

    it('still lifts an object schema that also carries a scalar union', () => {
      const objectWithUnion = {
        type: 'object',
        properties: { id: { type: 'string' } },
        anyOf: [{ type: 'string' }, { type: 'null' }],
      };
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(objectWithUnion));

      expect(liftedNames(result)).toHaveLength(1);
      expect(schemaAt(result, '/a').$ref).toMatch(/^#\/components\/schemas\//);
    });

    it('lifts one under its registered name, since that name is deliberate', () => {
      const registry = new Map([[hashOf(nullableString), 'NullableString']]);
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(nullableString), registry);

      expect(liftedNames(result)).toEqual(['NullableString']);
      expect(schemaAt(result, '/a')).toEqual({ $ref: '#/components/schemas/NullableString' });
    });

    it('lifts a registered one even where it is used once', () => {
      const registry = new Map([[hashOf(nullableString), 'NullableString']]);
      const single = specWithRepeatedSchema(nullableString, ['/a']);
      const result = deduplicateOpenAPISpec(single, registry);

      expect(liftedNames(result)).toEqual(['NullableString']);
    });

    it('leaves an unregistered one used once inline', () => {
      const result = deduplicateOpenAPISpec(specWithRepeatedSchema(nullableString, ['/a']));

      expect(liftedNames(result)).toEqual([]);
      expect(schemaAt(result, '/a')).toEqual(nullableString);
    });
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
