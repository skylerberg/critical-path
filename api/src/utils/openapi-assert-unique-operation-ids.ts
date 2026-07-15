type SpecObject = Record<string, unknown>;

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(key: string): key is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(key);
}

export function assertUniqueOperationIds(spec: SpecObject): SpecObject {
  const paths = spec.paths;
  if (!paths || typeof paths !== 'object') return spec;

  const seen = new Map<string, string>();
  const collisions: { operationId: string; locations: string[] }[] = [];

  for (const [pathKey, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [methodKey, operation] of Object.entries(pathItem as Record<string, unknown>)) {
      if (!isHttpMethod(methodKey)) continue;
      if (!operation || typeof operation !== 'object') continue;
      const op = operation as Record<string, unknown>;
      if (typeof op.operationId !== 'string') continue;
      const where = `${methodKey.toUpperCase()} ${pathKey}`;
      const existing = seen.get(op.operationId);
      if (existing) {
        const collision = collisions.find((c) => c.operationId === op.operationId);
        if (collision) {
          collision.locations.push(where);
        } else {
          collisions.push({
            operationId: op.operationId,
            locations: [existing, where],
          });
        }
      } else {
        seen.set(op.operationId, where);
      }
    }
  }

  if (collisions.length > 0) {
    const detail = collisions
      .map((c) => `  ${c.operationId}: ${c.locations.join(', ')}`)
      .join('\n');
    throw new Error(
      `OpenAPI spec has duplicate operationIds; client codegen will break:\n${detail}`
    );
  }

  return spec;
}
