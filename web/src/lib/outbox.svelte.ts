import { SvelteMap } from 'svelte/reactivity';
import { api, type ApiError } from '../api/client';
import { connectivity } from './connectivity.svelte';
import { conflictDrafts, mergeVersion, type TaskVersion } from './conflictDrafts.svelte';
import { newId } from './ids';
import { deleteOps, readQueue, writeOp } from './offline-db';
import {
  isAlreadyApplied,
  sendRequest,
  type QueuedOp,
  type MoveIntent,
  type ConflictContext,
  type SerializedRequest,
} from './outbox-ops';
import { byRank, placeBetweenNeighbors, type Ranked } from './ranks';
import { session } from './session.svelte';

// A queue is a promise that the work is still coming, and an unbounded one is a
// promise the app cannot keep. Past these, the oldest work stops being something
// the user still means and starts being something they have forgotten — so it is
// surfaced as unsent rather than replayed into a board that has moved on.
const MAX_QUEUED_OPS = 500;
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Long enough that work sitting unsent stops looking like a slow save.
export const STALE_QUEUE_WARNING_MS = 24 * 60 * 60 * 1000;
const MAX_SERVER_ERROR_ATTEMPTS = 3;

export type IssueReason =
  | 'conflict'
  | 'gone'
  | 'forbidden'
  | 'rejected'
  | 'server'
  | 'expired'
  | 'approximate-placement';

/**
 * Something the user has to be told about, either because their change did not
 * land or because it landed somewhere other than where they aimed. The request
 * is kept alongside so the panel can still show what the change *was*: a report
 * that says "this failed" without saying what "this" contained is how a queue
 * loses work while claiming it did not.
 */
export interface OutboxIssue {
  id: string;
  label: string;
  detail: string;
  reason: IssueReason;
  severity: 'failed' | 'adjusted';
  projectId: string;
  entityId: string;
  taskId?: string;
  queuedAt: string;
  at: string;
  request: SerializedRequest;
}

export interface SubmitInput {
  projectId: string;
  entityId: string;
  label: string;
  request: SerializedRequest;
  semantics?: QueuedOp['semantics'];
  move?: MoveIntent;
  conflict?: ConflictContext;
}

type RaisedIssue = Pick<OutboxIssue, 'reason' | 'severity' | 'detail'> &
  Partial<Pick<OutboxIssue, 'taskId' | 'request'>>;

export type SubmitResult<T> =
  | { status: 'sent'; data: T }
  // Accepted and waiting. The caller's optimistic update stands as-is; there is
  // nothing to roll back and nothing yet to report.
  | { status: 'queued' }
  | { status: 'failed'; error: ApiError };

class OutboxStore {
  #ops = $state<QueuedOp[]>([]);
  #issues = $state<OutboxIssue[]>([]);
  draining = $state(false);

  #seq = 0;
  #drain: Promise<void> | null = null;
  #hydrated = false;

  /**
   * Assigned by the shell to re-read the board once the queue has emptied. The
   * outbox deliberately knows nothing about the board store: the dependency runs
   * the other way, because every board mutation calls in here.
   */
  onSettled: (() => void) | undefined;

  // Overridable so the retry tests do not spend real seconds asleep.
  retryDelayMs = 1000;
  /**
   * How long to wait before trying the queue again on its own.
   *
   * Everything else that triggers a drain is an event that might not happen: the
   * `online` event only fires when the interface changes, `onReachable` needs a
   * request to have succeeded, and the reconnect heal needs the socket to have
   * dropped in the first place. A server that was down while the socket stayed
   * up satisfies none of them, and the queue would sit there indefinitely with
   * the user told only that it is waiting. So the queue also retries itself.
   */
  wakeDelayMs = 15_000;
  #wakeTimer: ReturnType<typeof setTimeout> | undefined;
  #wakeAttempts = 0;
  /**
   * Bumped by `reset()`, which is what a sign-out runs. A drain or a hydrate
   * already waiting on the network resumes into an account that is no longer
   * here, and both write — an issue, a conflict draft, the queue itself — so both
   * check this after every await rather than trusting that the queue they were
   * started for is still the queue on screen.
   */
  #generation = 0;

  constructor() {
    connectivity.onReachable = () => {
      void this.drain();
    };
  }

  get pending(): readonly QueuedOp[] {
    return this.#ops;
  }

  get issues(): readonly OutboxIssue[] {
    return this.#issues;
  }

  get count(): number {
    return this.#ops.length;
  }

  #pendingByEntity = $derived.by(() => {
    const counts = new SvelteMap<string, number>();
    for (const op of this.#ops) {
      counts.set(op.entityId, (counts.get(op.entityId) ?? 0) + 1);
    }
    return counts;
  });

  // Drives the per-card marker, so pending state is visible at the point of the
  // work rather than only in a global banner.
  isPending(entityId: string): boolean {
    return this.#pendingByEntity.has(entityId);
  }

  get oldestQueuedAt(): string | null {
    return this.#ops[0]?.queuedAt ?? null;
  }

  /**
   * Sends now when there is nothing in the way, queues otherwise. A non-empty
   * queue is very much in the way: letting a new mutation overtake the ones
   * already waiting is how a rename lands before the create it renames.
   */
  async submit<T>(input: SubmitInput): Promise<SubmitResult<T>> {
    const op = this.#build(input);
    if (!connectivity.reachable || this.#ops.length > 0 || this.draining) {
      this.#enqueue(op);
      return { status: 'queued' };
    }
    const outcome = await sendRequest(op.request);
    if (outcome.kind === 'ok') {
      return { status: 'sent', data: outcome.data as T };
    }
    if (outcome.kind === 'unreachable') {
      this.#enqueue(op);
      return { status: 'queued' };
    }
    return { status: 'failed', error: outcome.error };
  }

  #build(input: SubmitInput): QueuedOp {
    return {
      id: newId(),
      seq: ++this.#seq,
      userId: session.user?.id ?? '',
      projectId: input.projectId,
      entityId: input.entityId,
      semantics: input.semantics ?? 'plain',
      label: input.label,
      request: input.request,
      move: input.move,
      conflict: input.conflict,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    };
  }

  /**
   * The in-memory queue is what the UI reads and what the drain replays; the
   * write is durability across a reload. So the caller is never made to wait on
   * storage — a browser whose IndexedDB is wedged would otherwise hang every
   * board mutation behind a cache the feature can do without.
   */
  #enqueue(op: QueuedOp): void {
    const merged = this.#coalesce(op);
    if (merged !== null) {
      this.#ops = this.#ops.map((queued) => (queued.id === merged.id ? merged : queued));
      void writeOp(merged);
      return;
    }
    this.#ops = [...this.#ops, op];
    void writeOp(op);
    this.#enforceBounds();
    this.#scheduleWake();
  }

  // Backs off so a long outage is not a request every fifteen seconds forever,
  // and stops entirely once there is nothing left to send.
  #scheduleWake(): void {
    if (this.#wakeTimer !== undefined || this.#ops.length === 0) {
      return;
    }
    const delay = Math.min(this.wakeDelayMs * 2 ** this.#wakeAttempts, 5 * 60_000);
    this.#wakeAttempts += 1;
    this.#wakeTimer = setTimeout(() => {
      this.#wakeTimer = undefined;
      void this.drain();
    }, delay);
  }

  #cancelWake(): void {
    clearTimeout(this.#wakeTimer);
    this.#wakeTimer = undefined;
  }

  /**
   * Two edits to the same card while offline become one.
   *
   * Not an optimization — a correctness fix. Each guarded edit carries an
   * `expected_updated_at` naming the last version the server confirmed, and both
   * of these name the same one. Replayed separately the first would succeed and
   * bump the card's `updated_at`, and the second would then fail its
   * precondition against a version the *same user* had just written: a conflict
   * with nobody, offering to merge their text with their own text.
   *
   * Merging the patches and keeping the original precondition asks the server
   * the question the user actually means — "apply my latest text, if nobody else
   * has touched this since I went offline".
   */
  #coalesce(op: QueuedOp): QueuedOp | null {
    if (op.semantics !== 'contentEdit' || op.conflict === undefined) {
      return null;
    }
    const existing = this.#ops.find(
      (queued) => queued.semantics === 'contentEdit' && queued.entityId === op.entityId
    );
    if (existing === undefined || existing.conflict === undefined) {
      return null;
    }
    const body: Record<string, unknown> = {
      ...asRecord(existing.request.body),
      ...asRecord(op.request.body),
      // The newer patch carries a baseline that has not been confirmed by
      // anyone; the older one is the last thing the server agreed to.
      expected_updated_at: asRecord(existing.request.body).expected_updated_at,
    };
    return {
      ...existing,
      label: op.label,
      request: { ...existing.request, body },
      conflict: {
        ...existing.conflict,
        mine: mergeVersion(existing.conflict.base, {
          title: typeof body.title === 'string' ? body.title : undefined,
          description:
            'description' in body ? (body.description as TaskVersion['description']) : undefined,
        }),
      },
    };
  }

  // Overflow drops the *oldest*, and says so. Silently discarding the newest
  // would be worse and silently discarding anything would be worst.
  #enforceBounds(): void {
    const cutoff = Date.now() - MAX_QUEUE_AGE_MS;
    const doomed = this.#ops.filter(
      (op, index) => index < this.#ops.length - MAX_QUEUED_OPS || Date.parse(op.queuedAt) < cutoff
    );
    if (doomed.length === 0) {
      return;
    }
    for (const op of doomed) {
      this.#raise(op, {
        reason: 'expired',
        severity: 'failed',
        detail: 'Waited too long to be sent and was not applied. Your version is kept here.',
      });
    }
    this.#forget(doomed);
  }

  async hydrate(): Promise<void> {
    const userId = session.user?.id;
    if (userId === undefined || userId === '' || this.#hydrated) {
      return;
    }
    this.#hydrated = true;
    const generation = this.#generation;
    const stored = await readQueue(userId);
    // A sign-out while the read was in flight has already emptied the queue.
    // Assigning here would put the departing account's work back and then send it
    // under whoever signs in next.
    if (generation !== this.#generation || stored.length === 0) {
      return;
    }
    // Continue the sequence rather than restarting it, so ops queued this load
    // still sort after the ones read back from the last one.
    this.#seq = Math.max(this.#seq, ...stored.map((op) => op.seq));
    this.#ops = stored;
    this.#enforceBounds();
    // Work read back from a previous load is owed a send as much as work queued
    // in this one.
    void this.drain();
  }

  async drain(): Promise<void> {
    this.#drain ??= this.#run().finally(() => {
      this.#drain = null;
    });
    await this.#drain;
  }

  async #run(): Promise<void> {
    if (this.#ops.length === 0) {
      return;
    }
    this.#cancelWake();
    this.draining = true;
    const generation = this.#generation;
    let applied = 0;
    try {
      // One read per project, taken before that project's first move is replayed
      // and advanced locally as its moves land. Keyed by project rather than held
      // as a single board: one queue can hold moves for several, and rekeying one
      // against another's board places the card among neighbors it has never had.
      // Moves are the only ops that need this, so a queue without one never pays
      // for it.
      const boards = new Map<string, BoardTasks>();
      while (this.#ops.length > 0) {
        const op = this.#ops[0]!;
        const board =
          op.semantics === 'move' && op.move !== undefined
            ? await this.#boardFor(boards, op.projectId)
            : null;
        if (generation !== this.#generation) {
          return;
        }
        const rekeyed = board === null ? null : this.#rekey(op, board);
        const request = rekeyed?.request ?? op.request;
        const outcome = await sendRequest(request);
        if (generation !== this.#generation) {
          return;
        }
        if (outcome.kind === 'unreachable') {
          // Nothing was decided. Everything stays queued, in order, for next time.
          break;
        }
        if (outcome.kind === 'ok' || isAlreadyApplied(op, outcome)) {
          applied += 1;
          if (board !== null && op.move !== undefined) {
            applyMoveLocally(board, op.entityId, op.move.columnId, request);
          }
          // Reported only once the move has landed. `adjusted` claims the change
          // was applied somewhere other than where it was aimed, which a placement
          // computed before the request cannot know — raising it from #rekey filed
          // the same notice once per attempt, and a retry against fresh neighbors
          // may not be approximate at all.
          if (rekeyed?.exact === false) {
            this.#raise(op, {
              reason: 'approximate-placement',
              severity: 'adjusted',
              detail:
                'The cards it was dropped between are gone, so it went to the end of the column.',
            });
          }
          this.#forget([op]);
          continue;
        }
        const verdict = await this.#handleHttpFailure(op, outcome.error, request);
        if (generation !== this.#generation) {
          return;
        }
        if (verdict === 'halt') {
          break;
        }
        if (verdict === 'retry-fresh') {
          // The cached board is what produced the key the server just refused, and
          // #rekey is a pure function of it: retrying against the same read would
          // send the identical request and spend the one attempt this op gets.
          await this.#refreshBoard(boards, op.projectId);
          if (generation !== this.#generation) {
            return;
          }
          continue;
        }
        if (verdict === 'retry') {
          continue;
        }
      }
    } finally {
      // Only for the run that is still the current one: an abandoned run
      // resolving late must not clear the flag under the run that replaced it.
      if (generation === this.#generation) {
        this.draining = false;
      }
    }
    if (applied > 0) {
      // Progress means the server is answering, so the next wait starts short
      // again rather than inheriting the backoff from the outage.
      this.#wakeAttempts = 0;
      this.onSettled?.();
    }
    // Anything still queued is waiting on a network that may come back without
    // announcing itself.
    this.#scheduleWake();
  }

  async #handleHttpFailure(
    op: QueuedOp,
    error: ApiError,
    request: SerializedRequest
  ): Promise<'halt' | 'retry' | 'retry-fresh' | 'next'> {
    // Nothing left in the queue can do better against a session the server is
    // rejecting, so stop rather than spending the rest of it on the same answer.
    // The work does not outlive this: the client's 401 hook clears the session,
    // which drops the durable copy with `clearOfflineCache` and this one with
    // `reset()`. The drain below notices that through `#generation`.
    if (error.status === 401) {
      return 'halt';
    }
    if (error.status === 409 && op.semantics === 'contentEdit' && op.conflict !== undefined) {
      // Hands the decision to the resolution UI the app already has, with the
      // user's text preserved, rather than inventing a second conflict surface.
      conflictDrafts.set(op.conflict.taskId, { mine: op.conflict.mine, base: op.conflict.base });
      this.#raise(op, {
        reason: 'conflict',
        severity: 'failed',
        // Not "while you were offline": an op also queues behind one already
        // waiting, so this reaches someone whose network never went anywhere.
        // What is true in every case that gets here is that theirs landed first.
        detail:
          'Someone else edited this before your change was sent. Your version is kept — open the card to merge.',
        taskId: op.conflict.taskId,
      });
      this.#forget([op]);
      return 'next';
    }
    if (error.status === 409 && op.semantics === 'move' && op.attempts === 0) {
      // The slot was taken between reading the board and writing to it. One
      // fresh read is the whole fix, which is what separates this from 'retry'.
      this.#bumpAttempts(op);
      return 'retry-fresh';
    }
    if (error.status === 404 || error.status === 403) {
      const doomed = this.#ops.filter((queued) => queued.entityId === op.entityId);
      this.#raise(op, {
        reason: error.status === 404 ? 'gone' : 'forbidden',
        severity: 'failed',
        detail:
          error.status === 404
            ? `No longer on the board, so ${countPhrase(doomed.length)} could not be applied.`
            : `You no longer have access, so ${countPhrase(doomed.length)} could not be applied.`,
        request,
      });
      // Everything else queued against this card is doomed for the same reason,
      // and saying so once is the honest way to report it.
      this.#forget(doomed);
      return 'next';
    }
    if (error.status >= 500 && op.attempts + 1 < MAX_SERVER_ERROR_ATTEMPTS) {
      this.#bumpAttempts(op);
      await sleep(this.retryDelayMs * 2 ** op.attempts);
      return 'retry';
    }
    this.#raise(op, {
      reason: error.status >= 500 ? 'server' : 'rejected',
      severity: 'failed',
      detail:
        error.status >= 500
          ? `The server could not save this (${String(error.status)}). Your version is kept here.`
          : error.message,
      request,
    });
    // Dropped rather than retried forever: one request the server will never
    // accept must not hold every later change hostage behind it.
    this.#forget([op]);
    return 'next';
  }

  // Pure, and deliberately reports nothing: the caller raises the
  // approximate-placement notice once the move has actually landed.
  #rekey(op: QueuedOp, board: BoardTasks): { request: SerializedRequest; exact: boolean } {
    const move = op.move!;
    const siblings = board.tasks
      .filter((task) => task.column_id === move.columnId && task.id !== op.entityId)
      .sort(byRank);
    const { placement, exact } = placeBetweenNeighbors(siblings, {
      afterId: move.afterId,
      beforeId: move.beforeId,
    });
    const body = { ...(op.request.body as Record<string, unknown>), ...placement };
    return { request: { ...op.request, body }, exact };
  }

  async #boardFor(boards: Map<string, BoardTasks>, projectId: string): Promise<BoardTasks | null> {
    const cached = boards.get(projectId);
    return cached ?? (await this.#refreshBoard(boards, projectId));
  }

  // A read that fails leaves the previous one in place rather than dropping back
  // to no board at all: stale neighbors still beat replaying the offline
  // `sort_key` the op recorded, which is the one thing rekeying exists to avoid.
  async #refreshBoard(
    boards: Map<string, BoardTasks>,
    projectId: string
  ): Promise<BoardTasks | null> {
    const board = await this.#readBoard(projectId);
    if (board !== null) {
      boards.set(projectId, board);
    }
    return boards.get(projectId) ?? null;
  }

  async #readBoard(projectId: string): Promise<BoardTasks | null> {
    try {
      const result = await api.GET('/api/projects/{id}', { params: { path: { id: projectId } } });
      // Deliberately not routed through the board store: replay needs the
      // server's version to compute against, while the screen must keep showing
      // the user's own until the queue has actually landed.
      return result.data === undefined ? null : { tasks: [...result.data.tasks] };
    } catch {
      return null;
    }
  }

  #bumpAttempts(op: QueuedOp): void {
    const updated = { ...op, attempts: op.attempts + 1 };
    this.#ops = this.#ops.map((queued) => (queued.id === op.id ? updated : queued));
    void writeOp(updated);
  }

  #raise(op: QueuedOp, issue: RaisedIssue): void {
    this.#issues = [
      ...this.#issues,
      {
        id: newId(),
        label: op.label,
        projectId: op.projectId,
        entityId: op.entityId,
        queuedAt: op.queuedAt,
        at: new Date().toISOString(),
        request: op.request,
        ...issue,
      },
    ];
  }

  #forget(ops: readonly QueuedOp[]): void {
    const ids = new Set(ops.map((op) => op.id));
    this.#ops = this.#ops.filter((op) => !ids.has(op.id));
    void deleteOps([...ids]);
  }

  dismissIssue(id: string): void {
    this.#issues = this.#issues.filter((issue) => issue.id !== id);
  }

  dismissAllIssues(): void {
    this.#issues = [];
  }

  /**
   * Signing out takes the queue with it. Anything still waiting belongs to the
   * account that is leaving, and replaying it under the next one would attribute
   * one person's work to another — as would leaving its issues on screen, which
   * name the cards it was about.
   *
   * The durable copy is not dropped here. `session` clears it through
   * `clearOfflineCache` on every path that ends a session deliberately, and on
   * the one path that does not — an unreachable server with no remembered
   * account — the rows are meant to survive: `#hydrated` going back to false is
   * what lets the next signed-in load read them again.
   */
  reset(): void {
    this.#cancelWake();
    this.#wakeAttempts = 0;
    this.#ops = [];
    this.#issues = [];
    this.#seq = 0;
    this.#hydrated = false;
    this.draining = false;
    this.#generation += 1;
    // Dropped along with the queue it was draining. `drain()` memoizes the run in
    // flight, so leaving this set hands the next account's hydrate the run that
    // was abandoned here instead of one of its own, and its work then sits unsent
    // with no timer behind it. Safe to drop because every await in `#run` is
    // followed by a generation check, so the abandoned run cannot write.
    this.#drain = null;
  }
}

interface BoardTasks {
  tasks: (Ranked & { column_id: string })[];
}

// Keeps the shadow board in step as moves land, so two queued moves into the
// same column do not both compute against the same stale neighbors.
function applyMoveLocally(
  board: BoardTasks,
  taskId: string,
  columnId: string,
  request: SerializedRequest
): void {
  const sortKey = (request.body as { sort_key?: string } | undefined)?.sort_key;
  const task = board.tasks.find((candidate) => candidate.id === taskId);
  if (task === undefined || sortKey === undefined) {
    return;
  }
  task.column_id = columnId;
  task.sort_key = sortKey;
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function countPhrase(count: number): string {
  return count === 1 ? 'your change' : `${String(count)} of your changes`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const outbox = new OutboxStore();
