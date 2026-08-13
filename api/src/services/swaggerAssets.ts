import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';

const require = createRequire(import.meta.url);
const gzip = promisify(gzipCallback);

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
  contentType: string;
  body: Buffer;
  // Compressed once at first read. The route is public and the bundle is 1.5 MB
  // of exactly the content type the global compress() middleware acts on, so
  // without this every request from every reader — and every request an
  // unauthenticated caller cares to make — costs a fresh gzip of the whole
  // thing. Serving it pre-encoded is also what makes that middleware skip it.
  gzip: Buffer;
  // Strong and content-derived, so a reader that already holds the bytes
  // revalidates into a 304 rather than being sent 1.5 MB again each hour.
  etag: string;
}

async function load(name: SwaggerAssetName): Promise<SwaggerAsset> {
  const body = await readFile(require.resolve(`swagger-ui-dist/${name}`));
  return {
    contentType: ASSET_CONTENT_TYPES[name],
    body,
    gzip: await gzip(body),
    etag: `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`,
  };
}

// The promise is cached, not the result, so concurrent first requests share one
// read and one compression instead of racing to do both. A rejection is evicted
// so a transient read failure is not cached for the life of the process.
const cache = new Map<SwaggerAssetName, Promise<SwaggerAsset>>();

export function readSwaggerAsset(name: SwaggerAssetName): Promise<SwaggerAsset> {
  let pending = cache.get(name);
  if (pending === undefined) {
    pending = load(name).catch((err: unknown) => {
      cache.delete(name);
      throw err;
    });
    cache.set(name, pending);
  }
  return pending;
}
