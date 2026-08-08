#!/usr/bin/env node
// Event types for `cpath watch`, generated from realtime-events.json at the repo
// root — dumped by `npm run realtime:dump`, exactly as openapi.json is. Nothing
// is filtered: that document declares no paths, so every schema in it is part of
// the envelope union rather than something a path reaches.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { redump } from './redump.mjs';
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

if (process.env.REALTIME_DOC_PATH === undefined && redump('realtime:dump')) {
  console.log('Re-dumped realtime-events.json');
}
const doc = JSON.parse(await readFile(DOC_PATH, 'utf8'));
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, HEADER + '\n' + astToString(await openapiTS(doc)), 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
