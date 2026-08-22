#!/usr/bin/env node
// Event types for `cpath watch`. The generator itself is shared with the web
// app's, under ../../scripts/lib.

import openapiTS, { astToString } from 'openapi-typescript';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateRealtimeTypes } from '../../scripts/lib/generate-client.mjs';

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'api',
  'realtime.generated.ts'
);

await generateRealtimeTypes({ outputPath: OUTPUT_PATH, openapiTS, astToString });
