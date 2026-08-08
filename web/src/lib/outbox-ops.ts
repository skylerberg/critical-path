import { api, ApiError, assertOk } from '../api/client';
import type { paths } from '../api/api.generated';
import type { TaskVersion } from './conflictDrafts.svelte';

export type MutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * A queued mutation is stored as the request it would have made, not as a
 * closure, because it has to survive a reload. The first attempt replays the
 * same record the queue would — there is deliberately no second code path that
 * could drift from it.
 */
export interface SerializedRequest {
  method: MutationMethod;
  path: keyof paths;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

/**
 * Only three behaviors differ once a queued request comes back, so the queue
 * carries that distinction rather than a arm-per-endpoint union that would have
 * to be extended in three places for every new board mutation:
 *
 * - `create` — the client supplies the id, so a duplicate on replay is this very
 *   op having already landed. That is a success, not a conflict.
 * - `move` — the stored `sort_key` was computed against the board as it looked
 *   offline. The intent is the neighbors, so the key is recomputed at replay.
 * - `contentEdit` — carries an `expected_updated_at` precondition and so can
 *   come back as a real conflict needing the user.
 * - `plain` — replay as recorded.
 */
export type OpSemantics = 'create' | 'move' | 'contentEdit' | 'plain';

// Where the user put the card, in the only terms that survive other people
// moving things underneath: which card it went after, and which it went before.
export interface MoveIntent {
  columnId: string;
  afterId: string | null;
  beforeId: string | null;
}

export interface ConflictContext {
  taskId: string;
  mine: TaskVersion;
  base: TaskVersion;
}

export interface QueuedOp {
  id: string;
  // Assigned at submit and never reused, so replay order is the order the work
  // was done in even after a reload reads the store back in key order.
  seq: number;
  userId: string;
  projectId: string;
  /**
   * The board entity this op is about. When one op fails for good — the card was
   * deleted, access was lost — every other queued op on the same entity is
   * doomed too, and reporting them as one item is the difference between "your
   * change to Fix login couldn't be saved" and eight separate failures.
   */
  entityId: string;
  semantics: OpSemantics;
  /** Written at submit, when the call site still knows what the user did. */
  label: string;
  request: SerializedRequest;
  move?: MoveIntent;
  conflict?: ConflictContext;
  queuedAt: string;
  attempts: number;
}

export type SendOutcome =
  | { kind: 'ok'; data: unknown }
  // The request never reached anyone: nothing was decided, so nothing is lost.
  | { kind: 'unreachable' }
  // Carries the ApiError itself rather than a copy of its fields, so every
  // caller that already knows how to read one — the cycle reporter, the
  // duplicate-label handler, the conflict path — keeps working untouched.
  | { kind: 'http'; error: ApiError };

/**
 * The one place a stored request becomes a call. openapi-fetch types each method
 * against its own path, which a record read back from IndexedDB cannot satisfy;
 * this mirrors `realtime.svelte.ts`, where an arriving frame is asserted once at
 * the edge so that nothing downstream has to. The paths and bodies that get here
 * are built by `board.svelte.ts` against the generated types, so the assertion
 * covers rehydration, not authorship.
 */
type LooseClient = Record<
  MutationMethod,
  (path: string, init: Record<string, unknown>) => Promise<unknown>
>;

export async function sendRequest(request: SerializedRequest): Promise<SendOutcome> {
  const client = api as unknown as LooseClient;
  const init: Record<string, unknown> = {};
  if (request.pathParams !== undefined || request.query !== undefined) {
    init.params = { path: request.pathParams, query: request.query };
  }
  if (request.body !== undefined) {
    init.body = request.body;
  }
  try {
    const result = await client[request.method](request.path, init);
    // assertOk turns a non-2xx into an ApiError and hands back the payload
    // otherwise, which is exactly the split the caller needs.
    return { kind: 'ok', data: assertOk(result as Parameters<typeof assertOk>[0]) };
  } catch (error) {
    if (error instanceof ApiError) {
      return { kind: 'http', error };
    }
    // fetch rejects rather than resolving when the request never got an answer,
    // which is the only signal that separates "offline" from "refused".
    return { kind: 'unreachable' };
  }
}

// A create replayed after it already landed answers 409 on the client-supplied
// id. That is this op having succeeded, and the only thing left to do is stop
// retrying it.
export function isAlreadyApplied(op: QueuedOp, outcome: SendOutcome): boolean {
  return op.semantics === 'create' && outcome.kind === 'http' && outcome.error.status === 409;
}
