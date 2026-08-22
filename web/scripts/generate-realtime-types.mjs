#!/usr/bin/env node
// Types for the /ws contract, from the API's realtime-events.json. Nothing is
// filtered, unlike the API client: that document declares no paths, so nothing in
// it is reachable-from-a-path in the way that filter selects for. Most of its
// schemas are envelope members, but not all — RealtimeCloseCode is a standalone
// union of the codes the socket can be closed with, and src/lib/realtime-types.ts
// re-exports it.

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
  `// DO NOT EDIT. Regenerate with: pnpm run generate:realtime\n`;
await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, header + '\n' + astToString(await openapiTS(doc)), 'utf8');
console.log(`Wrote ${OUTPUT_PATH}`);
