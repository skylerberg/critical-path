import type { Type } from 'arktype';
import type { TypedResponse } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import type { JSONParsed } from 'hono/utils/types';
import { resolver, type ResponsesWithResolver } from 'hono-openapi';

// The statuses a handler returns, declared once. The same object is spread into
// describeRoute's `responses` and read back through `Returned<typeof …>` as the
// handler's return type, so the documented response and the returned one cannot
// drift: hono-openapi validates nothing at runtime, and before this a handler
// could quietly stop answering what its own spec promised.
//
// Error bodies are deliberately not declared here. They are produced by thrown
// AppErrors through onError, never by a handler return, so they stay ordinary
// spreads from ./errors and constrain nothing.

const DECLARED = Symbol('declared-response');
const NO_CONTENT = Symbol('no-content');
const RAW = Symbol('raw-body');

type Declaration = Type | typeof NO_CONTENT | typeof RAW;

type DeclaredResponses = Record<number, { [DECLARED]: Declaration }>;

export type Returned<D extends DeclaredResponses> = {
  [S in keyof D & number]: S extends StatusCode
    ? D[S][typeof DECLARED] extends typeof RAW
      ? Response
      : D[S][typeof DECLARED] extends Type
        ? Response & TypedResponse<JSONParsed<D[S][typeof DECLARED]['infer']>, S, 'json'>
        : Response & TypedResponse<null, S, 'body'>
    : never;
}[keyof D & number];

// Annotated rather than inferred, like the two below: the inferred form names
// types reachable only through `node_modules`, which `tsc --declaration` writes
// into the .d.ts as a relative path. That path leaves the project root whenever
// `node_modules` is a symlink — every worktree — and `npm run build` fails there
// on code that is fine.
export function jsonResponse<T extends Type>(
  description: string,
  schema: T
): ResponsesWithResolver[string] & { [DECLARED]: T } {
  return {
    description,
    content: { 'application/json': { schema: resolver(schema) } },
    [DECLARED]: schema,
  };
}

export function emptyResponse(description: string): {
  description: string;
  [DECLARED]: typeof NO_CONTENT;
} {
  return { description, [DECLARED]: NO_CONTENT };
}

// Bytes rather than JSON: streamed stored objects and the project export
// archive. The response object is written out in full because these are the
// shapes no schema describes, and the return stays a bare Response — there is
// nothing here for a payload type to check.
export function rawResponse(
  response: ResponsesWithResolver[string]
): ResponsesWithResolver[string] & { [DECLARED]: typeof RAW } {
  return { ...response, [DECLARED]: RAW };
}
