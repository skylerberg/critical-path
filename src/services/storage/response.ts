import type { Context } from 'hono';
import { Readable } from 'node:stream';
import type { StoredObject } from './types';

// Content-Length comes from the stored size so clients still get a progress bar.
// A storage failure after this point can only truncate the body, never become an
// error status, so callers must settle every 404 before they get here.
export function storedObjectResponse(c: Context, object: StoredObject): Response {
  c.header('Content-Length', String(object.size));
  return c.body(Readable.toWeb(object.stream), 200);
}
