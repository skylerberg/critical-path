import crypto from 'crypto';

type SchemaObject = Record<string, unknown>;

interface SchemaEntry {
  count: number;
  name: string;
  schema: SchemaObject;
  registered: boolean;
}

export function isInlineSchema(obj: SchemaObject): boolean {
  return (
    (obj.type === 'object' && obj.properties !== undefined) ||
    obj.allOf !== undefined ||
    obj.oneOf !== undefined ||
    obj.anyOf !== undefined
  );
}

const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

const IDENTITY_KEYWORDS = [
  '$ref',
  'const',
  'enum',
  'properties',
  'items',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'additionalProperties',
];

function isScalarMember(member: unknown): boolean {
  if (!member || typeof member !== 'object' || Array.isArray(member)) return false;
  const obj = member as SchemaObject;
  if (typeof obj.type !== 'string' || !SCALAR_TYPES.has(obj.type)) return false;
  return IDENTITY_KEYWORDS.every((keyword) => obj[keyword] === undefined);
}

export function isAnonymousScalarUnion(obj: SchemaObject): boolean {
  if (obj.properties !== undefined || obj.allOf !== undefined) return false;
  const members = [obj.anyOf, obj.oneOf].filter(Array.isArray).flat();
  return members.length > 0 && members.every(isScalarMember);
}

export function deduplicateOpenAPISpec(
  spec: SchemaObject,
  nameRegistry: Map<string, string> = new Map()
): SchemaObject {
  const result = JSON.parse(JSON.stringify(spec)) as SchemaObject;
  const schemaHashes = new Map<string, SchemaEntry>();
  const usedNames = new Set<string>();

  // Reserve registered names up front so the path-based fallback can't claim
  // them and force a numeric suffix on a real schema.
  for (const name of nameRegistry.values()) {
    usedNames.add(name);
  }

  function inferSchemaName(path: string[]): string {
    const skipSegments = [
      'paths',
      'responses',
      'content',
      'application/json',
      'schema',
      'properties',
      'items',
      'allOf',
      'oneOf',
      'anyOf',
    ];
    const meaningful = path.filter((p) => !skipSegments.includes(p) && !/^\d+$/.test(p));

    const baseName =
      meaningful
        .slice(-2)
        .map((s) => {
          const cleaned = s.replace(/[^a-zA-Z0-9]/g, '');
          return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        })
        .filter(Boolean)
        .join('') || 'Schema';

    let name = baseName;
    let counter = 1;
    while (usedNames.has(name)) {
      name = `${baseName}${counter}`;
      counter++;
    }
    usedNames.add(name);
    return name;
  }

  function findSchemas(obj: unknown, path: string[]): void {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => findSchemas(item, [...path, String(i)]));
      return;
    }

    const schemaObj = obj as SchemaObject;

    if (isInlineSchema(schemaObj)) {
      const hash = crypto.createHash('md5').update(JSON.stringify(schemaObj)).digest('hex');
      const existing = schemaHashes.get(hash);
      if (existing) {
        existing.count++;
      } else {
        const registered = nameRegistry.get(hash);
        const name = registered ?? inferSchemaName(path);
        schemaHashes.set(hash, {
          count: 1,
          name,
          schema: schemaObj,
          registered: registered !== undefined,
        });
      }
    }

    for (const [key, value] of Object.entries(schemaObj)) {
      findSchemas(value, [...path, key]);
    }
  }

  function shouldLift(entry: SchemaEntry): boolean {
    // Registered schemas are always lifted so consumers can import them by
    // name. Unregistered schemas only get lifted when used in 2+ places,
    // matching the original dedup behavior.
    if (entry.registered) return true;
    if (entry.count <= 1) return false;
    // A union of bare scalars is a shape, not a concept: every `string | null`
    // in the spec hashes alike, so lifting one hands 85 unrelated fields a name
    // inferred from whichever path happened to be walked first.
    return !isAnonymousScalarUnion(entry.schema);
  }

  function replaceWithRefs(obj: unknown): unknown {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(replaceWithRefs);

    const schemaObj = obj as SchemaObject;

    if (isInlineSchema(schemaObj)) {
      const hash = crypto.createHash('md5').update(JSON.stringify(schemaObj)).digest('hex');
      const entry = schemaHashes.get(hash);
      if (entry && shouldLift(entry)) {
        return { $ref: `#/components/schemas/${entry.name}` };
      }
    }

    const replaced: SchemaObject = {};
    for (const [key, value] of Object.entries(schemaObj)) {
      replaced[key] = replaceWithRefs(value);
    }
    return replaced;
  }

  findSchemas(result, []);

  const components = (result.components || {}) as SchemaObject;
  const componentSchemas = (components.schemas || {}) as SchemaObject;

  for (const [, entry] of schemaHashes) {
    if (shouldLift(entry)) {
      // Apply $ref substitution to nested inline schemas before lifting, so a
      // wrapper schema references its inner lifted schema instead of
      // duplicating its body. The top-level shape itself is the lifted schema,
      // not a ref to itself, so we only substitute its inner contents.
      const lifted: SchemaObject = {};
      for (const [key, value] of Object.entries(entry.schema)) {
        lifted[key] = replaceWithRefs(value);
      }
      componentSchemas[entry.name] = lifted;
    }
  }

  components.schemas = componentSchemas;
  result.components = components;
  result.paths = replaceWithRefs(result.paths);

  return result;
}
