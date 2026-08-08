#!/usr/bin/env node
// Event types for `cpath watch`, generated from the API's realtime-events.json.
// That document declares no paths, so unlike the API client nothing here is
// filtered: every schema in it is part of the envelope union.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH =
  process.env.REALTIME_DOC_PATH ?? resolve(__dirname, '..', '..', 'realtime-events.json');
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'realtime.generated.ts');

const source = relative(resolve(__dirname, '..', '..'), DOC_PATH);
const HEADER = `// AUTO-GENERATED FROM ${source}
// DO NOT EDIT. Regenerate with: npm run generate-realtime
`;

const doc = JSON.parse(await readFile(DOC_PATH, 'utf8'));
const ast = await openapiTS(doc);
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, HEADER + '\n' + astToString(ast), 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
