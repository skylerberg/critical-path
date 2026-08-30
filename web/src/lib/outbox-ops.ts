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

// Where the user put the row, in the only terms that survive other people
// moving things underneath: which row it went after, and which it went before.
//
// `kind` names the list to rank it against at replay, because the three scopes
// read from three different places — a column's tasks, the board's columns, and
// one task's checklist. A task move is the only kind that existed when this was
// first stored, so an op read back from a queue written before the other two
// learned to travel is normalised into it rather than migrated.
export type MoveIntent =
  | { kind: 'task'; columnId: string; afterId: string | null; beforeId: string | null }
  | { kind: 'column'; afterId: string | null; beforeId: string | null }
  | { kind: 'checklist'; taskId: string; afterId: string | null; beforeId: string | null };

/**
 * What the op is about, tagged.
 *
 * This replaces a bare `entityId`, which was a name for the *type* of the value
 * — an id, of something — rather than for its role, and so ended up serving four
 * of them: group a doomed row's siblings, find the edit to coalesce with, name
 * the row a move re-ranks, and answer which card a change belongs to. Two of
 * those need it to be a task and could not say so; one needed to know which of
 * three things it was and got that by reading `move.kind` next door, which is
 * the tell that the tag was always required and merely stored elsewhere.
 *
 * Orthogonal to `OpSemantics`, deliberately and permanently: that says how a
 * reply is to be read at replay, this says what was written. A `create` can be a
 * task or a checklist item, so collapsing the two would multiply out.
 *
 * Read it through `rowsOf` and `cardsOf` rather than by hand. Every question the
 * queue asks of a subject is one of those two, and a `switch` at a call site is
 * a third definition waiting to disagree with them.
 */
export type Subject =
  | { kind: 'task'; id: string }
  // One request, many cards. A bulk archive used to travel as the first id in
  // the set, which meant nineteen of twenty cards showed no unsent marker and a
  // refusal doomed none of their queued work.
  | { kind: 'tasks'; ids: string[] }
  | { kind: 'column'; id: string }
  | { kind: 'label'; id: string }
  | { kind: 'checklistItem'; id: string; taskId: string }
  | { kind: 'comment'; id: string; taskId: string }
  /**
   * A row read back from a queue written before subjects existed, whose card is
   * genuinely not recoverable — the id is the row's own and nothing stored says
   * whose card it was on. It replays exactly as it always did; only the card it
   * would have been reported against is missing, which is what was true of it
   * before this type as well. Never constructed by a submit.
   */
  | { kind: 'legacyRow'; id: string };

/**
 * The rows this request writes. What a 404 or a 403 is a verdict on, and what a
 * move re-ranks against its siblings.
 */
export function rowsOf(subject: Subject): string[] {
  return subject.kind === 'tasks' ? subject.ids : [subject.id];
}

/**
 * The cards this op shows up on — for the per-card unsent marker and the open
 * card's own save indicator. Empty for the things that are not on a card at all;
 * a column reorder is not a card's business and must not make one look unsaved.
 */
export function cardsOf(subject: Subject): string[] {
  switch (subject.kind) {
    case 'task':
      return [subject.id];
    case 'tasks':
      return subject.ids;
    case 'checklistItem':
    case 'comment':
      return [subject.taskId];
    case 'column':
    case 'label':
    case 'legacyRow':
      return [];
  }
}

/** The single row a move re-ranks. Moves are never bulk, so this is total. */
export function movedRowId(subject: Subject): string {
  return rowsOf(subject)[0]!;
}

/**
 * The same row of the same kind. The kind is compared and not only the id
 * because these ids are client-generated and nothing stops a checklist item and
 * a task sharing one; two writes to different things must not coalesce, and a
 * checklist reply's `updated_at` must not retire a task's precondition.
 */
export function sameRow(a: Subject, b: Subject): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  const left = rowsOf(a);
  const right = rowsOf(b);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Whether a verdict on `failed` also settles `queued`.
 *
 * A 404 or a 403 is about the rows the failed request named. Anything writing
 * one of those rows is finished for the same reason — and so is anything sitting
 * *on* one of them, because a card that is gone takes its checklist and its
 * comments with it. Both directions come out of the same intersection: a card's
 * own ops have it in `rowsOf`, its children have it in `cardsOf`.
 */
export function doomedWith(queued: Subject, failed: Subject): boolean {
  const gone = new Set(rowsOf(failed));
  return [...rowsOf(queued), ...cardsOf(queued)].some((id) => gone.has(id));
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
   * What this op is about. When one op fails for good — the card was deleted,
   * access was lost — everything else queued against the same row, and against a
   * card that row *is*, is doomed too; reporting that as one item is the
   * difference between "your change to Fix login couldn't be saved" and eight
   * separate failures.
   */
  subject: Subject;
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
