#!/usr/bin/env node
// This app's `/ws` event types. `src/lib/realtime-types.ts` re-exports the
// envelope union and `RealtimeCloseCode` from what this writes. The generator
// itself is shared with the CLI's, under ../../scripts/lib.

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
