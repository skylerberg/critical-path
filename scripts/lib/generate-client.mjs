// The whole of both generators, for both client packages. What stays behind in
// each package is the openapi-typescript import and the path it writes: there is
// no repository-root node_modules and never will be (four packages, four
// lockfiles, no pnpm workspace), so a bare specifier resolved from this directory
// finds nothing. The dependency is therefore passed in, and everything that does
// not need it lives here — one copy, so the two clients cannot drift apart in
// what they filter, what they check, or what their headers say.
//
// This module imports node builtins only.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadDocument } from './spec-source.mjs';
import { filterDeprecated } from './openapi-filter.mjs';

async function emit({ outputPath, header, doc, openapiTS, astToString }) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, header + '\n' + astToString(await openapiTS(doc)), 'utf8');
}

// Each generator is a whole program, so a failure prints and exits nonzero rather
// than surfacing as an unhandled rejection — and the `&& prettier --write` half of
// the package script does not run on a client that was never written.
async function run(body) {
  try {
    await body();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

/**
 * Write the HTTP client types from the api package's OpenAPI spec.
 * `SPEC_PATH` / `SPEC_URL` name one document outright, overriding that.
 */
export function generateApiTypes({ outputPath, openapiTS, astToString }) {
  return run(async () => {
    const { doc, source } = await loadDocument({
      filename: 'openapi.json',
      urlPath: '/api/openapi.json',
      path: process.env.SPEC_PATH,
      url: process.env.SPEC_URL,
    });
    const { removedOps, removedSchemas } = filterDeprecated(doc);
    const header =
      `// AUTO-GENERATED FROM ${source}\n` +
      `// DO NOT EDIT. Regenerate with: pnpm run generate:api\n` +
      `// Deprecated operations and schemas are filtered out at generation time.\n`;
    await emit({ outputPath, header, doc, openapiTS, astToString });
    console.log(
      `Wrote ${outputPath} (filtered ${removedOps} deprecated operations, ${removedSchemas} deprecated schemas)`
    );
  });
}

/**
 * Write the `/ws` event types from the api package's realtime document.
 * `REALTIME_DOC_PATH` / `REALTIME_DOC_URL` name one document outright.
 *
 * Nothing is filtered here, unlike the HTTP client: that document declares no
 * paths, so nothing in it is reachable-from-a-path in the way that filter selects
 * for, and running it would delete the whole document.
 */
export function generateRealtimeTypes({ outputPath, openapiTS, astToString }) {
  return run(async () => {
    const { doc, source } = await loadDocument({
      filename: 'realtime-events.json',
      urlPath: '/api/realtime-events.json',
      path: process.env.REALTIME_DOC_PATH,
      url: process.env.REALTIME_DOC_URL,
    });
    const header =
      `// AUTO-GENERATED FROM ${source}\n` +
      `// DO NOT EDIT. Regenerate with: pnpm run generate:realtime\n`;
    await emit({ outputPath, header, doc, openapiTS, astToString });
    console.log(`Wrote ${outputPath}`);
  });
}
