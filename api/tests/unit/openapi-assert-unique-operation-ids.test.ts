import { describe, it, expect } from 'vitest';
import { assertUniqueOperationIds } from '../../src/utils/openapi-assert-unique-operation-ids';

type Operation = { operationId?: string; deprecated?: boolean };
type PathItem = Record<string, Operation>;

function specWith(paths: Record<string, PathItem>): Record<string, unknown> {
  return { openapi: '3.0.0', paths };
}

describe('assertUniqueOperationIds', () => {
  it('returns the spec unchanged when all operationIds are unique', () => {
    const spec = specWith({
      '/api/foo': { get: { operationId: 'getFoo' } },
      '/api/bar': { post: { operationId: 'postBar' } },
    });

    expect(assertUniqueOperationIds(spec)).toBe(spec);
  });

  it('throws when two paths share the same operationId', () => {
    const spec = specWith({
      '/api/activities/mark-seen': {
        put: { operationId: 'putApiActivitiesMarkSeen' },
      },
      '/api/activities/mark_seen': {
        put: { operationId: 'putApiActivitiesMarkSeen' },
      },
    });

    expect(() => assertUniqueOperationIds(spec)).toThrowError(/putApiActivitiesMarkSeen/);
    expect(() => assertUniqueOperationIds(spec)).toThrowError(/PUT \/api\/activities\/mark-seen/);
    expect(() => assertUniqueOperationIds(spec)).toThrowError(/PUT \/api\/activities\/mark_seen/);
  });

  it('groups three-way collisions into a single entry', () => {
    const spec = specWith({
      '/a': { get: { operationId: 'dup' } },
      '/b': { get: { operationId: 'dup' } },
      '/c': { get: { operationId: 'dup' } },
    });

    try {
      assertUniqueOperationIds(spec);
      throw new Error('expected to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('dup');
      expect(message).toContain('GET /a');
      expect(message).toContain('GET /b');
      expect(message).toContain('GET /c');
    }
  });

  it('ignores non-HTTP-method keys on path items (parameters, summary, etc.)', () => {
    const spec = specWith({
      '/api/foo': {
        get: { operationId: 'getFoo' },
        parameters: { operationId: 'shouldNotCount' } as Operation,
      },
    });

    expect(() => assertUniqueOperationIds(spec)).not.toThrow();
  });

  it('ignores operations without an operationId', () => {
    const spec = specWith({
      '/api/foo': { get: {} },
      '/api/bar': { get: { operationId: 'getBar' } },
    });

    expect(() => assertUniqueOperationIds(spec)).not.toThrow();
  });

  it('returns the spec unchanged when paths is missing', () => {
    const spec: Record<string, unknown> = { openapi: '3.0.0' };
    expect(assertUniqueOperationIds(spec)).toBe(spec);
  });
});
