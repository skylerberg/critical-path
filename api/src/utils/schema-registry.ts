import crypto from 'crypto';
import { toOpenAPISchema } from '@standard-community/standard-openapi';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import * as schemas from '../schemas/index';
import { isInlineSchema } from './openapi-dedupe';

// Mirrors hono-openapi's internal arktype morph handling so that our manual
// conversion produces byte-identical OpenAPI schema output to what
// generateSpecs() embeds in the spec. Without this, ArkType throws on any
// schema that uses `.pipe(...)` morphs (e.g. uuid, isoDateString).
const arktypeMorphFallback = (ctx: { base: unknown }) => ctx.base;
const TO_OPENAPI_OPTS = {
  options: { fallback: arktypeMorphFallback },
} as const;

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  // ArkType schemas are callable functions, not plain objects, so we accept
  // either typeof "object" or "function" — what matters is the "~standard"
  // marker that defines a Standard Schema.
  if (value === null) return false;
  if (typeof value !== 'object' && typeof value !== 'function') return false;
  return (
    '~standard' in value && typeof (value as { '~standard': unknown })['~standard'] === 'object'
  );
}

function toPrettyName(exportName: string): string {
  const stripped = exportName.replace(/Schema$/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * Builds a Map<schemaJsonHash, prettyName> using the same md5 hash the dedupe
 * utility computes for inline schemas — the two must stay in sync or
 * registered names silently stop matching.
 *
 * Aliases (two exports pointing at the same schema object via `===`) collapse
 * to the shortest, alphabetically-first name. Throws on hash collisions
 * between distinct schemas.
 */
export async function buildSchemaNameRegistry(): Promise<Map<string, string>> {
  const byIdentity = new Map<StandardSchemaV1, string[]>();
  for (const [exportName, value] of Object.entries(schemas)) {
    if (!isStandardSchema(value)) continue;
    const existing = byIdentity.get(value);
    if (existing) {
      existing.push(exportName);
    } else {
      byIdentity.set(value, [exportName]);
    }
  }

  const registry = new Map<string, string>();
  const collisions: { hash: string; existing: string; conflicting: string }[] = [];

  // Variants we need to register for each schema:
  //  - open: as it appears in resolver() / validator("query"|"param", ...)
  //  - closed: as it appears via jsonValidator(), which calls
  //    `.onUndeclaredKey("delete")` and adds `additionalProperties: false`.
  // Same source schema, two distinct shapes in the spec — we need both.
  const variantBuilders: ((s: StandardSchemaV1) => StandardSchemaV1)[] = [
    (s) => s,
    (s) => {
      const arkSchema = s as unknown as {
        onUndeclaredKey?: (action: 'delete') => StandardSchemaV1;
      };
      return typeof arkSchema.onUndeclaredKey === 'function'
        ? arkSchema.onUndeclaredKey('delete')
        : s;
    },
  ];

  for (const [schema, names] of byIdentity) {
    const canonicalExport = names.sort((a, b) =>
      a.length !== b.length ? a.length - b.length : a.localeCompare(b)
    )[0];
    const prettyName = toPrettyName(canonicalExport);

    for (const build of variantBuilders) {
      let variantSchema: StandardSchemaV1;
      try {
        variantSchema = build(schema);
      } catch {
        continue;
      }

      let openapi: unknown;
      try {
        openapi = (await toOpenAPISchema(variantSchema, TO_OPENAPI_OPTS)).schema;
      } catch {
        continue;
      }

      if (!openapi || typeof openapi !== 'object') continue;
      if (!isInlineSchema(openapi as Record<string, unknown>)) continue;

      const hash = crypto.createHash('md5').update(JSON.stringify(openapi)).digest('hex');

      const existing = registry.get(hash);
      if (existing && existing !== prettyName) {
        collisions.push({ hash, existing, conflicting: prettyName });
        continue;
      }
      registry.set(hash, prettyName);
    }
  }

  if (collisions.length > 0) {
    const lines = collisions
      .map(
        (c) =>
          `  - ${c.existing} and ${c.conflicting} produce identical JSON Schema (hash ${c.hash.slice(0, 8)}…)`
      )
      .join('\n');
    throw new Error(
      `Schema name registry has collisions:\n${lines}\n` +
        `Disambiguate by renaming one schema, or remove the duplicate so only one canonical name exists.`
    );
  }

  return registry;
}
