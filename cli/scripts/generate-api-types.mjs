#!/usr/bin/env node
// The CLI's HTTP client. Everything but the openapi-typescript dependency and
// the output path is shared with the web app's generator, under
// ../../scripts/lib — a bare specifier cannot be resolved from there, so the
// dependency is handed in.

import openapiTS, { astToString } from 'openapi-typescript';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateApiTypes } from '../../scripts/lib/generate-client.mjs';

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'api',
  'api.generated.ts'
);

await generateApiTypes({ outputPath: OUTPUT_PATH, openapiTS, astToString });
