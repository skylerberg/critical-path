import { validator } from 'hono-openapi';
import type { Type } from 'arktype';

// The explicit failure hook returns 422 with { error, details }; the
// @hono/standard-validator default would return 400 with a different body.
export function jsonValidator<T extends Type>(schema: T) {
  const strippedSchema = schema.onUndeclaredKey('delete');
  return validator('json', strippedSchema, (result, c) => {
    if (result.success) return;

    return c.json(
      {
        error: 'Validation failed',
        details: result.error.map((issue) => ({
          path: Array.isArray(issue.path) ? issue.path.map(String).join('.') : '',
          message: issue.message,
        })),
      },
      422
    );
  });
}
