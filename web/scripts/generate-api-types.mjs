#!/usr/bin/env node
// Deprecated operations/schemas — and schemas only they referenced — are
// filtered before codegen so stale call sites turn into TypeScript errors.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { loadDocument } from './spec-source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'api.generated.ts');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

function filterDeprecated(spec) {
  let removedOps = 0;
  let removedSchemas = 0;

  if (spec.paths && typeof spec.paths === 'object') {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      for (const method of Object.keys(pathItem)) {
        if (!HTTP_METHODS.has(method.toLowerCase())) continue;
        const op = pathItem[method];
        if (op && typeof op === 'object' && op.deprecated === true) {
          delete pathItem[method];
          removedOps++;
        }
      }
      const remaining = Object.keys(pathItem).filter((k) => HTTP_METHODS.has(k.toLowerCase()));
      if (remaining.length === 0) {
        delete spec.paths[pathKey];
      }
    }
  }

  if (spec.components?.schemas && typeof spec.components.schemas === 'object') {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      if (schema && typeof schema === 'object' && schema.deprecated === true) {
        delete spec.components.schemas[name];
        removedSchemas++;
      }
    }
    removedSchemas += pruneUnreachableSchemas(spec);
  }

  return { removedOps, removedSchemas };
}

function collectSchemaRefs(node, refs) {
  if (Array.isArray(node)) {
    for (const item of node) collectSchemaRefs(item, refs);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.$ref === 'string') {
    const match = /^#\/components\/schemas\/(.+)$/.exec(node.$ref);
    if (match) refs.add(match[1]);
  }
  for (const value of Object.values(node)) collectSchemaRefs(value, refs);
}

function pruneUnreachableSchemas(spec) {
  const schemas = spec.components.schemas;
  const reachable = new Set();
  const { components, ...rest } = spec;
  collectSchemaRefs(rest, reachable);
  for (const [name, value] of Object.entries(components)) {
    if (name !== 'schemas') collectSchemaRefs(value, reachable);
  }
  const queue = [...reachable];
  while (queue.length > 0) {
    const name = queue.pop();
    if (!(name in schemas)) continue;
    const nested = new Set();
    collectSchemaRefs(schemas[name], nested);
    for (const ref of nested) {
      if (!reachable.has(ref)) {
        reachable.add(ref);
        queue.push(ref);
      }
    }
  }
  let removed = 0;
  for (const name of Object.keys(schemas)) {
    if (!reachable.has(name)) {
      delete schemas[name];
      removed++;
    }
  }
  return removed;
}

async function main() {
  const { doc: spec, source } = await loadDocument({
    filename: 'openapi.json',
    urlPath: '/api/openapi.json',
    path: process.env.SPEC_PATH,
    url: process.env.SPEC_URL,
  });
  const { removedOps, removedSchemas } = filterDeprecated(spec);
  const ast = await openapiTS(spec);
  const header =
    `// AUTO-GENERATED FROM ${source}\n` +
    `// DO NOT EDIT. Regenerate with: pnpm run generate:api\n` +
    `// Deprecated operations and schemas are filtered out at generation time.\n`;
  const output = header + '\n' + astToString(ast);
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, output, 'utf8');
  console.log(
    `Wrote ${OUTPUT_PATH} (filtered ${removedOps} deprecated operations, ${removedSchemas} deprecated schemas)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
