#!/usr/bin/env node
// Event types for the /ws envelope, from the API's realtime-events.json. Nothing
// is filtered, unlike the API client: that document declares no paths, so every
// schema in it is part of the envelope union rather than something a path reaches.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';
import { loadDocument } from './spec-source.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '..', 'src', 'api', 'realtime.generated.ts');

const { doc, source } = await loadDocument({
  filename: 'realtime-events.json',
  urlPath: '/api/realtime-events.json',
  path: process.env.REALTIME_DOC_PATH,
  url: process.env.REALTIME_DOC_URL,
});

const header =
  `// AUTO-GENERATED FROM ${source}\n` +
  `// DO NOT EDIT. Regenerate with: npm run generate:realtime\n`;
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, header + '\n' + astToString(await openapiTS(doc)), 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
