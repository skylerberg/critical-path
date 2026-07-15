import { validator } from 'hono-openapi';
import type { Type } from 'arktype';

// Without an explicit failure hook, @hono/standard-validator returns 400 with
// { data, error: issues[], success } — echoing the input and contradicting the
// documented { error: string } body.
function requestValidator<T extends Type>(target: 'param' | 'query', schema: T) {
  return validator(target, schema, (result, c) => {
    if (result.success) return;

    return c.json({ error: result.error.map((issue) => issue.message).join('; ') }, 400);
  });
}

export function paramValidator<T extends Type>(schema: T) {
  return requestValidator('param', schema);
}

export function queryValidator<T extends Type>(schema: T) {
  return requestValidator('query', schema);
}
