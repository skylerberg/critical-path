#!/usr/bin/env node
// Deprecated operations/schemas are filtered before codegen so stale call
// sites turn into TypeScript errors.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const SPEC_URL = process.env.SPEC_URL || 'http://localhost:3001/api/openapi.json';
const SPEC_PATH = process.env.SPEC_PATH;
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'api.generated.ts');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);

const source = SPEC_PATH ?? SPEC_URL;
const HEADER = `// AUTO-GENERATED FROM ${source}
// DO NOT EDIT. Regenerate with: npm run generate:api
// Deprecated operations and schemas are filtered out at generation time.
`;

async function loadSpec() {
  if (SPEC_PATH) {
    return JSON.parse(await readFile(SPEC_PATH, 'utf8'));
  }
  const res = await fetch(SPEC_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${SPEC_URL}: HTTP ${res.status}`);
  }
  return res.json();
}

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
  }

  return { removedOps, removedSchemas };
}

async function main() {
  const spec = await loadSpec();
  const { removedOps, removedSchemas } = filterDeprecated(spec);
  const ast = await openapiTS(spec);
  const output = HEADER + '\n' + astToString(ast);
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
