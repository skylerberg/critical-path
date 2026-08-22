import http from 'node:http';
import { Storage } from '@google-cloud/storage';

import { authorized } from './auth.ts';

// Serves per-PR preview builds from a pr/<n>/ prefix in the web bucket behind
// the wildcard host pr-<n>.criticalpath.skylerberg.com. A preview is a full
// same-origin virtual host (/api and /ws still reach the API at the LB), so
// this server only handles the static side: stream the object if it exists,
// else fall back to that PR's index.html so a deep-link refresh boots the SPA.

const BUCKET_NAME = process.env.WEB_BUCKET;
const HOST_SUFFIX = process.env.PREVIEW_HOST_SUFFIX;
// The shared HTTP Basic credential ("user:pass"), mounted from the
// critical-path-preview-auth Secret Manager secret by terraform. The gate is
// fail-closed: see auth.ts, and infra/terraform/README.md for setting the
// value. Not required at startup like the two above — a revision that cannot
// read the secret does not start at all, and one that reads a placeholder
// should serve 401s, not crash-loop.
const PREVIEW_AUTH = process.env.PREVIEW_AUTH;
const PR_RE = /^pr-(\d+)\./;
const HAS_EXTENSION = /\.[^/]+$/;

if (!BUCKET_NAME || !HOST_SUFFIX) {
  console.error('WEB_BUCKET and PREVIEW_HOST_SUFFIX must be set');
  process.exit(1);
}

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);

function send(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers?: Record<string, string>
): void {
  res.writeHead(status, headers).end(body);
}

async function serve(pr: string, pathname: string, res: http.ServerResponse): Promise<void> {
  const file = bucket.file(`pr/${pr}${pathname}`);
  let [exists] = await file.exists().catch((): [boolean] => [false]);
  // SPA fallback: route-like paths (no extension, or .html) resolve to the
  // PR's index.html so a deep-link refresh boots the shell. Missing assets
  // (extensioned and absent) stay 404 so a broken build isn't masked as HTML.
  if (!exists && (!HAS_EXTENSION.test(pathname) || pathname.endsWith('.html'))) {
    const index = bucket.file(`pr/${pr}/index.html`);
    [exists] = await index.exists().catch((): [boolean] => [false]);
    if (!exists) {
      send(res, 404, 'not found');
      return;
    }
    stream(index, res);
    return;
  }
  if (!exists) {
    send(res, 404, 'not found');
    return;
  }
  stream(file, res);
}

async function stream(
  file: ReturnType<typeof bucket.file>,
  res: http.ServerResponse
): Promise<void> {
  const meta = (await file.getMetadata().catch(() => [{}]))[0] as {
    contentType?: string;
    cacheControl?: string;
  };
  res.writeHead(200, {
    'Content-Type': meta.contentType ?? 'application/octet-stream',
    'Cache-Control': meta.cacheControl ?? 'no-cache, no-store, must-revalidate',
  });
  file
    .createReadStream()
    .on('error', () => {
      if (!res.headersSent) res.writeHead(404).end();
      res.destroy();
    })
    .pipe(res);
}

const server = http.createServer((req, res) => {
  const host = req.headers.host ?? '';
  const match = PR_RE.exec(host);
  if (!match || !host.endsWith(HOST_SUFFIX)) {
    send(res, 404, 'not a preview host');
    return;
  }
  if (!authorized(req.headers.authorization, PREVIEW_AUTH)) {
    send(res, 401, 'auth required', { 'WWW-Authenticate': 'Basic realm="preview"' });
    return;
  }
  const pr = match[1]!;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', `http://${host}`).pathname);
  } catch {
    send(res, 400, 'bad path');
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  serve(pr, pathname, res).catch((err: unknown) => {
    console.error('preview-edge serve failed', err);
    if (!res.headersSent) send(res, 500, 'internal error');
  });
});

const port = Number(process.env.PORT ?? 8080);
server.listen(port, () => console.log(`preview-edge on :${port}`));
