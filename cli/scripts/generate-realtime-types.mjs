#!/usr/bin/env node
// Event types for `cpath watch`, generated from api/realtime-events.json —
// dumped by `pnpm run realtime:dump` in api/, exactly as openapi.json is. Nothing
// is filtered: that document declares no paths, so nothing in it is reachable
// only through one — it is the envelope union plus the socket's close codes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { API_ROOT, REPO_ROOT, redump } from './redump.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOC_PATH = process.env.REALTIME_DOC_PATH ?? resolve(API_ROOT, 'realtime-events.json');
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'realtime.generated.ts');

const source = relative(REPO_ROOT, DOC_PATH);
const HEADER = `// AUTO-GENERATED FROM ${source}
// DO NOT EDIT. Regenerate with: pnpm run generate-realtime
`;

if (process.env.REALTIME_DOC_PATH === undefined && redump('realtime:dump')) {
  console.log(`Re-dumped ${DOC_PATH}`);
}
const doc = JSON.parse(await readFile(DOC_PATH, 'utf8'));
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, HEADER + '\n' + astToString(await openapiTS(doc)), 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
