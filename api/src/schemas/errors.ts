import { resolver, type ResolverReturnType } from 'hono-openapi';
import { type } from 'arktype';

export const errorSchema = type({
  error: 'string',
});

export const validationErrorSchema = type({
  error: "'Validation failed'",
  details: type({
    path: 'string',
    message: 'string',
  }).array(),
});

// ArkType reduces validationErrorSchema.or(errorSchema) to plain errorSchema
// (the former is a structural subtype), so the union is assembled as a raw
// OpenAPI anyOf component instead.
const validationOrUnprocessableSchemaResolver = {
  toOpenAPISchema: async () => {
    const [validation, plain] = await Promise.all([
      resolver(validationErrorSchema).toOpenAPISchema(),
      resolver(errorSchema).toOpenAPISchema(),
    ]);
    return {
      schema: { $ref: '#/components/schemas/ValidationOrUnprocessableError' },
      components: {
        schemas: {
          ValidationOrUnprocessableError: { anyOf: [validation.schema, plain.schema] },
        },
      },
    };
  },
} as unknown as ResolverReturnType;

function errorResponse(
  status: number,
  description: string,
  schema = errorSchema
): Record<
  number,
  { description: string; content: { 'application/json': { schema: ResolverReturnType } } }
> {
  return {
    [status]: {
      description,
      content: {
        'application/json': {
          schema: resolver(schema),
        },
      },
    },
  };
}

export const badRequestErrorResponse = errorResponse(400, 'Bad Request');
export const unauthorizedErrorResponse = errorResponse(401, 'Authentication required or failed');
export const forbiddenErrorResponse = errorResponse(403, 'Forbidden - insufficient permissions');
export const notFoundErrorResponse = errorResponse(404, 'Not Found');
export const conflictErrorResponse = errorResponse(409, 'Conflict - resource already exists');
export const payloadTooLargeErrorResponse = errorResponse(413, 'Payload Too Large');
// 422 with { error, details } — schema validation failures from jsonValidator.
export const validationErrorResponse = errorResponse(
  422,
  'Validation error',
  validationErrorSchema
);
// 422 with plain { error } — domain-rule violations (e.g. cross-project references).
export const unprocessableErrorResponse = errorResponse(422, 'Unprocessable request');
// Both 422 shapes — for routes with jsonValidator plus domain-rule violations.
export const validationOrUnprocessableErrorResponse = {
  422: {
    description: 'Validation error or domain-rule violation',
    content: {
      'application/json': {
        schema: validationOrUnprocessableSchemaResolver,
      },
    },
  },
};
export const tooManyRequestsErrorResponse = errorResponse(429, 'Too Many Requests');
export const internalServerErrorResponse = errorResponse(500, 'Internal Server Error');
