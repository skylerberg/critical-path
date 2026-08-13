import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);

// Swagger UI's own bundle, read from the installed package rather than fetched
// from a CDN at render time. The docs page is served from the same origin as
// the app — one host serves the SPA and this API — and the SPA keeps its
// session token in that origin's localStorage, so a third-party script tag here
// is a third party holding every reader's credentials. Nothing about the page
// is worth that, and the bytes are already on disk.
//
// An allow-list of exactly two names rather than a path under a root: the name
// arrives in a URL, and this way the route is structurally incapable of
// resolving anything else out of node_modules, traversal or no traversal.
//
// The package is reached by require.resolve rather than imported, which is not
// a reference knip can see — hence its entry in knip's ignoreDependencies.
const ASSET_CONTENT_TYPES = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
} as const;

export type SwaggerAssetName = keyof typeof ASSET_CONTENT_TYPES;

export function isSwaggerAssetName(name: string): name is SwaggerAssetName {
  return Object.hasOwn(ASSET_CONTENT_TYPES, name);
}

export interface SwaggerAsset {
  body: Buffer;
  contentType: string;
}

const cache = new Map<SwaggerAssetName, Buffer>();

export async function readSwaggerAsset(name: SwaggerAssetName): Promise<SwaggerAsset> {
  let body = cache.get(name);
  if (body === undefined) {
    body = await readFile(require.resolve(`swagger-ui-dist/${name}`));
    cache.set(name, body);
  }
  return { body, contentType: ASSET_CONTENT_TYPES[name] };
}
