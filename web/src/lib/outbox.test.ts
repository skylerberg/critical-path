import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from './connectivity.svelte';
import { conflictDrafts } from './conflictDrafts.svelte';
import { outbox, type SubmitInput } from './outbox.svelte';
import { resetConnectionForTests, writeOp } from './offline-db';
import { session } from './session.svelte';
import { testSortKey, testUuid } from './test-ids';

/**
 * Sort keys by role, ascending in the order they are declared, and generated
 * rather than written out: `ranks.ts` passes BASE_62_DIGITS, under which most
 * strings are not legal keys as *input*. An invalid one throws from inside
 * `fractional-indexing` as an unhandled rejection naming whichever test happened
 * to be running, which is how a hand-picked `'W0'` here once failed a test three
 * describes away from the fixture holding it.
 */
const ANCHOR = testSortKey(0);
const NEXT_TO_ANCHOR = testSortKey(1);
// The key a move computed while offline, meaningless by the time it replays.
const OFFLINE_KEY = testSortKey(2);
const UNRELATED = testSortKey(3);
// A second read of the same board, with the anchors moved along it.
const SHIFTED_ANCHOR = testSortKey(5);
const SHIFTED_NEXT = testSortKey(6);
// A different project's board entirely.
const OTHER_ANCHOR = testSortKey(8);
const OTHER_NEXT = testSortKey(9);

const PROJECT_ID = testUuid('p1');
const TASK_ID = testUuid('t1');
const OTHER_ID = testUuid('t2');

const user = {
  id: testUuid('u1'),
  email: 'ada@example.com',
  name: 'Ada',
  avatar_url: null,
  email_verified: true,
};

function edit(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return {
    projectId: PROJECT_ID,
    entityId: TASK_ID,
    label: 'Renamed a card',
    request: {
      method: 'PATCH',
      path: '/api/tasks/{id}',
      pathParams: { id: TASK_ID },
      body: { title: 'new' },
    },
    ...overrides,
  };
}

function version(title: string) {
  return { title, description: null };
}

// A fetch that never gets an answer, which is the only thing that distinguishes
// being offline from being refused.
function unreachable(): void {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
}

// A fresh Response per call: a body can only be read once, so handing the same
// instance to a replay of several ops fails the second one for the wrong reason.
function alwaysRespond(status: number, body: unknown = {}): void {
  fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(status, body)));
}

// Targets a different row, so a test can make one op fail without the other.
function otherTaskEdit(label: string): SubmitInput {
  return edit({
    label,
    entityId: OTHER_ID,
    request: {
      method: 'PATCH',
      path: '/api/tasks/{id}',
      pathParams: { id: OTHER_ID },
      body: { title: 'other' },
    },
  });
}

function sentPaths(): string[] {
  return fetchMock.mock.calls.map((call) => new URL((call[0] as Request).url).pathname);
}

async function login(): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', user }));
  await session.login(user.email, 'password123');
  fetchMock.mockReset();
}

beforeEach(async () => {
  fetchMock.mockReset();
  localStorage.clear();
  conflictDrafts.clearAll();
  outbox.reset();
  connectivity.resetForTests();
  await resetConnectionForTests();
  await login();
  outbox.retryDelayMs = 0;
  outbox.wakeDelayMs = 60_000;
});

describe('submitting', () => {
  it('sends immediately when the server is reachable and nothing is waiting', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, updated_at: 'now' }));

    const result = await outbox.submit(edit());

    expect(result.status).toBe('sent');
    expect(outbox.count).toBe(0);
  });

  it('queues rather than failing when the request never gets an answer', async () => {
    unreachable();

    const result = await outbox.submit(edit());

    expect(result.status).toBe('queued');
    expect(outbox.count).toBe(1);
    expect(outbox.isPending(TASK_ID)).toBe(true);
    // The marker belongs to the card the work was queued against, so a queue
    // with anything in it must not light up every other card on the board.
    expect(outbox.isPending(OTHER_ID)).toBe(false);
  });

  it('reports a refused request as a failure instead of queuing it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'Bad title' }));

    const result = await outbox.submit(edit());

    expect(result).toMatchObject({ status: 'failed' });
    expect(outbox.count).toBe(0);
  });

  // Letting a later mutation overtake the ones already waiting is how a rename
  // lands before the create it renames.
  it('queues behind work that is already waiting even once reachable again', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'first' }));

    alwaysRespond(200);
    connectivity.noteReached();
    const result = await outbox.submit(edit({ label: 'second' }));

    expect(result.status).toBe('queued');
    expect(outbox.pending.map((op) => op.label)).toEqual(['first', 'second']);
  });
});

describe('draining', () => {
  // Two ops that send *distinguishable* requests, or the calls carry no evidence
  // of which was replayed first and a LIFO drain reads exactly the same.
  it('replays in the order the work was done', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'one' }));
    await outbox.submit(otherTaskEdit('two'));

    fetchMock.mockReset();
    alwaysRespond(200);
    await outbox.drain();

    expect(outbox.count).toBe(0);
    expect(sentPaths()).toEqual([`/api/tasks/${TASK_ID}`, `/api/tasks/${OTHER_ID}`]);
    const bodies = await Promise.all(
      fetchMock.mock.calls.map(
        async (call) => (await (call[0] as Request).clone().json()) as { title: string }
      )
    );
    expect(bodies.map((body) => body.title)).toEqual(['new', 'other']);
  });

  // Every other trigger is an event that might never happen: `online` only
  // fires when the interface changes, the reachable hook needs a request to
  // have already succeeded, and the reconnect heal needs the socket to have
  // dropped. A server that was down while the socket stayed up fires none of
  // them, and without this the queue would wait forever.
  it('retries on its own when nothing else tells it the server is back', async () => {
    outbox.wakeDelayMs = 5;
    unreachable();
    await outbox.submit(edit());
    expect(outbox.count).toBe(1);

    // No reconnect, no `online` event, no successful request — just the server
    // quietly starting to answer again.
    fetchMock.mockReset();
    alwaysRespond(200);
    await vi.waitFor(() => {
      expect(outbox.count).toBe(0);
    });
  });

  it('keeps everything queued when the network is still down', async () => {
    unreachable();
    await outbox.submit(edit());

    await outbox.drain();

    expect(outbox.count).toBe(1);
    expect(outbox.issues).toHaveLength(0);
  });

  it('treats a duplicate id on a replayed create as that create having landed', async () => {
    unreachable();
    await outbox.submit(
      edit({
        semantics: 'create',
        request: { method: 'POST', path: '/api/tasks', body: { id: TASK_ID, title: 'a' } },
      })
    );

    fetchMock.mockReset();
    alwaysRespond(409, { error: 'Task id already in use' });
    await outbox.drain();

    expect(outbox.count).toBe(0);
    expect(outbox.issues).toHaveLength(0);
  });

  it('runs the settled hook once work has actually landed', async () => {
    const settled = vi.fn();
    outbox.onSettled = settled;
    unreachable();
    await outbox.submit(edit());

    fetchMock.mockReset();
    alwaysRespond(200);
    await outbox.drain();

    expect(settled).toHaveBeenCalledTimes(1);
    outbox.onSettled = undefined;
  });
});

describe('when a replayed change cannot be applied', () => {
  it('hands a content conflict to the resolver with the user’s version intact', async () => {
    unreachable();
    await outbox.submit(
      edit({
        semantics: 'contentEdit',
        conflict: { taskId: TASK_ID, base: version('old'), mine: version('mine') },
      })
    );

    fetchMock.mockReset();
    alwaysRespond(409, { error: 'This task changed since you loaded it' });
    await outbox.drain();

    expect(conflictDrafts.get(TASK_ID)).toEqual({
      base: version('old'),
      mine: version('mine'),
    });
    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({ reason: 'conflict', taskId: TASK_ID });
    expect(outbox.count).toBe(0);
  });

  // Reporting eight separate failures for one deleted card is not a report, it
  // is noise that hides what happened.
  it('drops every queued change on a card that is gone and reports them once', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'rename' }));
    await outbox.submit(edit({ label: 'label change' }));
    await outbox.submit(otherTaskEdit('elsewhere'));

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'Not found' }));
    alwaysRespond(200);
    await outbox.drain();

    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({ reason: 'gone' });
    expect(outbox.issues[0]?.detail).toContain('2 of your changes');
    // The unrelated card's change is untouched by another card's fate.
    expect(outbox.count).toBe(0);
  });

  // The 403 half of the same arm: the card is still there, so "no longer on the
  // board" would send the user looking for a card they can see and cannot write.
  it('says access, not absence, when the card is refused rather than missing', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'rename' }));
    await outbox.submit(edit({ label: 'label change' }));
    await outbox.submit(otherTaskEdit('elsewhere'));

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'Forbidden' }));
    alwaysRespond(200);
    await outbox.drain();

    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({ reason: 'forbidden' });
    expect(outbox.issues[0]?.detail).toBe(
      'You no longer have access, so 2 of your changes could not be applied.'
    );
    // The second doomed op is forgotten rather than retried: two requests went
    // out, the refusal and the unrelated card's edit.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outbox.count).toBe(0);
  });

  it('keeps the queue when the session is rejected rather than discarding the work', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'first' }));
    await outbox.submit(otherTaskEdit('second'));

    fetchMock.mockReset();
    alwaysRespond(401, { error: 'Unauthorized' });
    await outbox.drain();

    expect(outbox.count).toBe(2);
    expect(outbox.issues).toHaveLength(0);
  });

  it('retries a server error, then reports it without wedging the queue behind it', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'doomed' }));
    await outbox.submit(otherTaskEdit('after'));

    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = new URL((input as Request).url);
      return Promise.resolve(
        url.pathname.includes(TASK_ID) ? jsonResponse(500, {}) : jsonResponse(200, {})
      );
    });
    await outbox.drain();

    // Three sends before it is given up on: the report alone is what a queue
    // with no retry at all produces, so counting the attempts is the only thing
    // that tells the two apart.
    expect(sentPaths().filter((path) => path.endsWith(TASK_ID))).toHaveLength(3);
    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({ reason: 'server' });
    // The change behind it still went out.
    expect(outbox.count).toBe(0);
  });

  it('drops a request the server will never accept instead of retrying it forever', async () => {
    unreachable();
    await outbox.submit(edit());

    fetchMock.mockReset();
    alwaysRespond(422, { error: 'Title is too long' });
    await outbox.drain();

    expect(outbox.count).toBe(0);
    expect(outbox.issues[0]).toMatchObject({ reason: 'rejected', detail: 'Title is too long' });
    // The content is kept, so the panel can still show what the change was.
    expect(outbox.issues[0]?.request.body).toEqual({ title: 'new' });
  });
});

describe('replaying a move made offline', () => {
  const AFTER_ID = testUuid('after');
  const BEFORE_ID = testUuid('before');
  const COLUMN_ID = testUuid('c1');

  function boardWith(tasks: { id: string; sort_key: string }[]) {
    return {
      project: { id: PROJECT_ID },
      columns: [],
      labels: [],
      tasks: tasks.map((task) => ({ ...task, column_id: COLUMN_ID })),
    };
  }

  // The server's board is read once and the move is written against it; the
  // PATCH is the second call.
  function serveBoard(tasks: { id: string; sort_key: string }[]): void {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      return Promise.resolve(
        request.method === 'GET' ? jsonResponse(200, boardWith(tasks)) : jsonResponse(200, {})
      );
    });
  }

  function moveOf(taskId: string, afterId: string, beforeId: string, label: string): SubmitInput {
    return edit({
      entityId: taskId,
      semantics: 'move',
      label,
      move: { kind: 'task' as const, columnId: COLUMN_ID, afterId, beforeId },
      request: {
        method: 'PATCH',
        path: '/api/tasks/{id}',
        pathParams: { id: taskId },
        // Computed against the board as it looked offline, and meaningless by
        // the time this is replayed.
        body: { column_id: COLUMN_ID, sort_key: OFFLINE_KEY },
      },
    });
  }

  async function queueMove(): Promise<void> {
    unreachable();
    await outbox.submit(moveOf(TASK_ID, AFTER_ID, BEFORE_ID, 'Moved a card'));
    fetchMock.mockReset();
  }

  async function replayedSortKey(): Promise<string | undefined> {
    const patch = fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .find((request) => request.method === 'PATCH');
    const body = (await patch?.clone().json()) as { sort_key?: string } | undefined;
    return body?.sort_key;
  }

  // The whole point of storing neighbors rather than the key: someone else
  // moved things while this was waiting, and the card still has to land where
  // the user dropped it.
  it('recomputes the key from the neighbors against the board as it looks now', async () => {
    await queueMove();
    serveBoard([
      { id: AFTER_ID, sort_key: ANCHOR },
      { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR },
    ]);

    await outbox.drain();

    const sortKey = await replayedSortKey();
    expect(sortKey).toBeDefined();
    expect(sortKey! > ANCHOR && sortKey! < NEXT_TO_ANCHOR).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  it('keeps the intent when only one of the two neighbors is left', async () => {
    await queueMove();
    serveBoard([
      { id: AFTER_ID, sort_key: ANCHOR },
      { id: testUuid('unrelated'), sort_key: UNRELATED },
    ]);

    await outbox.drain();

    const sortKey = await replayedSortKey();
    expect(sortKey! > ANCHOR && sortKey! < UNRELATED).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  // Falling back to the end of the column is a guess, and a guess the user is
  // told about rather than left to notice.
  it('appends and says so when both neighbors are gone', async () => {
    await queueMove();
    serveBoard([{ id: testUuid('unrelated'), sort_key: UNRELATED }]);

    await outbox.drain();

    const sortKey = await replayedSortKey();
    expect(sortKey! > UNRELATED).toBe(true);
    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({
      reason: 'approximate-placement',
      severity: 'adjusted',
    });
    // Adjusted, not failed: the move did land.
    expect(outbox.count).toBe(0);
  });

  function requestsOfMethod(method: string): Request[] {
    return fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .filter((request) => request.method === method);
  }

  async function replayedSortKeys(): Promise<(string | undefined)[]> {
    return Promise.all(
      requestsOfMethod('PATCH').map(async (request) => {
        const body = (await request.clone().json()) as { sort_key?: string };
        return body.sort_key;
      })
    );
  }

  /** GET answers move the neighbors apart on the second read; PATCH answers 409 then 200. */
  function serveShiftingBoard(secondRead: () => Promise<Response>): void {
    let reads = 0;
    let writes = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'GET') {
        reads += 1;
        return reads === 1
          ? Promise.resolve(
              jsonResponse(
                200,
                boardWith([
                  { id: AFTER_ID, sort_key: ANCHOR },
                  { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR },
                ])
              )
            )
          : secondRead();
      }
      writes += 1;
      return Promise.resolve(
        writes === 1
          ? jsonResponse(409, { error: 'That position was taken' })
          : jsonResponse(200, {})
      );
    });
  }

  // The retry exists because the slot was taken between the read and the write.
  // Recomputing against the read that produced the refused key is a pure function
  // of it, so it would send the identical request and spend the one attempt.
  it('reads the board again after a 409 instead of replaying the refused key', async () => {
    await queueMove();
    serveShiftingBoard(() =>
      Promise.resolve(
        jsonResponse(
          200,
          boardWith([
            { id: AFTER_ID, sort_key: SHIFTED_ANCHOR },
            { id: BEFORE_ID, sort_key: SHIFTED_NEXT },
          ])
        )
      )
    );

    await outbox.drain();

    expect(requestsOfMethod('GET')).toHaveLength(2);
    const keys = await replayedSortKeys();
    expect(keys).toHaveLength(2);
    expect(keys[0]! > ANCHOR && keys[0]! < NEXT_TO_ANCHOR).toBe(true);
    // Against the second board, which the first read could not have produced.
    expect(keys[1]! > SHIFTED_ANCHOR && keys[1]! < SHIFTED_NEXT).toBe(true);
    expect(outbox.count).toBe(0);
    expect(outbox.issues).toHaveLength(0);
  });

  // Stale neighbors still beat the key the op recorded offline, which is the one
  // thing rekeying exists to avoid sending.
  it('keeps the board it has when the second read fails', async () => {
    await queueMove();
    serveShiftingBoard(() => Promise.reject(new TypeError('Failed to fetch')));

    await outbox.drain();

    const keys = await replayedSortKeys();
    expect(keys).toHaveLength(2);
    expect(keys[1]).not.toBe(OFFLINE_KEY);
    expect(keys[1]! > ANCHOR && keys[1]! < NEXT_TO_ANCHOR).toBe(true);
  });

  // The notice claims the move landed somewhere other than where it was aimed,
  // so it belongs to the attempt that landed — not to every attempt.
  it('reports an approximate placement once across a retry', async () => {
    await queueMove();
    let writes = 0;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method === 'GET') {
        // Neither neighbor is left on either read, so both attempts append.
        return Promise.resolve(
          jsonResponse(200, boardWith([{ id: testUuid('x'), sort_key: UNRELATED }]))
        );
      }
      writes += 1;
      return Promise.resolve(writes === 1 ? jsonResponse(409, {}) : jsonResponse(200, {}));
    });

    await outbox.drain();

    expect(outbox.count).toBe(0);
    expect(outbox.issues.filter((issue) => issue.reason === 'approximate-placement')).toHaveLength(
      1
    );
  });

  // Two cards dropped into the same column while offline, the second aimed at the
  // first. The board is read once for the pair, so unless the first landing is
  // applied to that read the second is ranked against a card that is still sitting
  // where it was dragged from — which puts it on the wrong side of it.
  it('rekeys a move against where the move before it just landed', async () => {
    unreachable();
    await outbox.submit(moveOf(TASK_ID, AFTER_ID, BEFORE_ID, 'Moved the first card'));
    await outbox.submit(moveOf(OTHER_ID, TASK_ID, BEFORE_ID, 'Moved the second under it'));
    fetchMock.mockReset();

    serveBoard([
      { id: AFTER_ID, sort_key: ANCHOR },
      { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR },
      // Where the first card sat before it was dragged: past both anchors, which
      // is where a board that never saw the move would still rank it.
      { id: TASK_ID, sort_key: UNRELATED },
    ]);
    await outbox.drain();

    expect(requestsOfMethod('GET')).toHaveLength(1);
    const keys = await replayedSortKeys();
    expect(keys[0]! > ANCHOR && keys[0]! < NEXT_TO_ANCHOR).toBe(true);
    expect(keys[1]! > keys[0]! && keys[1]! < NEXT_TO_ANCHOR).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  // One queue holds every project's work. Rekeying a move against another
  // project's board places the card among neighbors it has never had.
  it("rekeys a queued column move against the board's columns", async () => {
    unreachable();
    await outbox.submit(
      edit({
        entityId: COLUMN_ID,
        semantics: 'move',
        label: 'Moved column',
        move: { kind: 'column' as const, afterId: AFTER_ID, beforeId: BEFORE_ID },
        request: {
          method: 'PATCH',
          path: '/api/columns/{id}',
          pathParams: { id: COLUMN_ID },
          body: { sort_key: OFFLINE_KEY },
        },
      })
    );
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      // The anchors moved while the queue waited, so the offline key is stale.
      return Promise.resolve(
        jsonResponse(200, {
          project: { id: PROJECT_ID },
          columns: [
            { id: AFTER_ID, sort_key: ANCHOR },
            { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR },
          ],
          labels: [],
          tasks: [],
        })
      );
    });
    await outbox.drain();

    const keys = await replayedSortKeys();
    expect(keys[0]).not.toBe(OFFLINE_KEY);
    expect(keys[0]! > ANCHOR && keys[0]! < NEXT_TO_ANCHOR).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  it("rekeys a queued checklist move against the task's own items", async () => {
    unreachable();
    await outbox.submit(
      edit({
        entityId: OTHER_ID,
        semantics: 'move',
        label: 'Reordered a checklist item',
        move: {
          kind: 'checklist' as const,
          taskId: TASK_ID,
          afterId: AFTER_ID,
          beforeId: BEFORE_ID,
        },
        request: {
          method: 'PATCH',
          path: '/api/checklist-items/{id}',
          pathParams: { id: OTHER_ID },
          body: { sort_key: OFFLINE_KEY },
        },
      })
    );
    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      // The checklist is not on the board payload, so this is the task read.
      if (new URL(request.url).pathname.includes('/api/tasks/')) {
        return Promise.resolve(
          jsonResponse(200, {
            id: TASK_ID,
            checklist_items: [
              { id: AFTER_ID, sort_key: ANCHOR },
              { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR },
            ],
          })
        );
      }
      return Promise.resolve(
        jsonResponse(200, { project: { id: PROJECT_ID }, columns: [], labels: [], tasks: [] })
      );
    });
    await outbox.drain();

    const keys = await replayedSortKeys();
    expect(keys[0]).not.toBe(OFFLINE_KEY);
    expect(keys[0]! > ANCHOR && keys[0]! < NEXT_TO_ANCHOR).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  it('rekeys each move against its own project', async () => {
    const OTHER_PROJECT = testUuid('p2');
    const OTHER_COLUMN = testUuid('c2');
    unreachable();
    await outbox.submit(
      edit({
        semantics: 'move',
        label: 'Moved here',
        move: {
          kind: 'task' as const,
          columnId: COLUMN_ID,
          afterId: AFTER_ID,
          beforeId: BEFORE_ID,
        },
        request: {
          method: 'PATCH',
          path: '/api/tasks/{id}',
          pathParams: { id: TASK_ID },
          body: { column_id: COLUMN_ID, sort_key: OFFLINE_KEY },
        },
      })
    );
    await outbox.submit(
      edit({
        projectId: OTHER_PROJECT,
        entityId: OTHER_ID,
        semantics: 'move',
        label: 'Moved there',
        move: {
          kind: 'task' as const,
          columnId: OTHER_COLUMN,
          afterId: AFTER_ID,
          beforeId: BEFORE_ID,
        },
        request: {
          method: 'PATCH',
          path: '/api/tasks/{id}',
          pathParams: { id: OTHER_ID },
          body: { column_id: OTHER_COLUMN, sort_key: OFFLINE_KEY },
        },
      })
    );
    fetchMock.mockReset();

    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      // Each board holds its own anchors, in its own column and at keys the other
      // never mentions. Rekeyed against the wrong one the anchors are missing
      // entirely, which appends and files an approximate-placement notice.
      const forOther = new URL(request.url).pathname.includes(OTHER_PROJECT);
      return Promise.resolve(
        jsonResponse(200, {
          project: { id: forOther ? OTHER_PROJECT : PROJECT_ID },
          columns: [],
          labels: [],
          tasks: forOther
            ? [
                { id: AFTER_ID, sort_key: OTHER_ANCHOR, column_id: OTHER_COLUMN },
                { id: BEFORE_ID, sort_key: OTHER_NEXT, column_id: OTHER_COLUMN },
              ]
            : [
                { id: AFTER_ID, sort_key: ANCHOR, column_id: COLUMN_ID },
                { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR, column_id: COLUMN_ID },
              ],
        })
      );
    });
    await outbox.drain();

    expect(requestsOfMethod('GET')).toHaveLength(2);
    const keys = await replayedSortKeys();
    expect(keys[0]! > ANCHOR && keys[0]! < NEXT_TO_ANCHOR).toBe(true);
    // Between its own board's anchors, not appended past a board it never used.
    expect(keys[1]! > OTHER_ANCHOR && keys[1]! < OTHER_NEXT).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });
});

// A queue is a promise that the work is still coming, and past these limits it is
// a promise the app cannot keep. What it must not do is quietly stop keeping it.
describe('the bounds the queue enforces', () => {
  const MAX_QUEUED_OPS = 500;

  it('drops the oldest change once it is full, and reports the one it dropped', async () => {
    unreachable();
    for (let index = 0; index <= MAX_QUEUED_OPS; index += 1) {
      await outbox.submit(edit({ label: `change ${String(index)}` }));
    }

    expect(outbox.count).toBe(MAX_QUEUED_OPS);
    expect(outbox.pending[0]?.label).toBe('change 1');
    expect(outbox.pending.at(-1)?.label).toBe(`change ${String(MAX_QUEUED_OPS)}`);
    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({
      reason: 'expired',
      severity: 'failed',
      label: 'change 0',
    });
  });

  // A queue written before column and checklist moves learned to travel: the
  // move it holds names no kind, and every scope test would read it as the one
  // it is not.
  it('replays a move queued by a build that knew only one kind of move', async () => {
    const COLUMN_ID = testUuid('c1');
    const AFTER_ID = testUuid('after');
    const BEFORE_ID = testUuid('before');
    await writeOp({
      id: testUuid('legacy'),
      seq: 1,
      userId: user.id,
      projectId: PROJECT_ID,
      entityId: TASK_ID,
      semantics: 'move',
      label: 'Moved by an older build',
      // Deliberately the old shape, cast in: this is what is actually at rest.
      move: { columnId: COLUMN_ID, afterId: AFTER_ID, beforeId: BEFORE_ID } as never,
      request: {
        method: 'PATCH',
        path: '/api/tasks/{id}',
        pathParams: { id: TASK_ID },
        body: { column_id: COLUMN_ID, sort_key: OFFLINE_KEY },
      },
      queuedAt: new Date().toISOString(),
      attempts: 0,
    });
    unreachable();
    await outbox.hydrate();
    // hydrate() starts a drain it does not await, and that one is still using the
    // rejecting fetch. Settling it here keeps it from landing after the swap below
    // and sending the offline key for a reason this test is not about.
    await outbox.drain();

    fetchMock.mockReset();
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        return Promise.resolve(jsonResponse(200, {}));
      }
      return Promise.resolve(
        jsonResponse(200, {
          project: { id: PROJECT_ID },
          columns: [],
          labels: [],
          tasks: [
            { id: AFTER_ID, sort_key: ANCHOR, column_id: COLUMN_ID },
            { id: BEFORE_ID, sort_key: NEXT_TO_ANCHOR, column_id: COLUMN_ID },
          ],
        })
      );
    });
    await outbox.drain();

    const patched = fetchMock.mock.calls
      .map((call) => call[0] as Request)
      .find((request) => request.method === 'PATCH')!;
    const { sort_key: replayed } = (await patched.clone().json()) as { sort_key: string };
    expect(replayed).not.toBe(OFFLINE_KEY);
    expect(replayed > ANCHOR && replayed < NEXT_TO_ANCHOR).toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  // A row stored by some other build, or one that got mangled on the way back
  // out. Whatever it is, a timestamp that cannot be read is not evidence that the
  // work behind it is stale.
  it('keeps stored work whose queued-at cannot be read at all', async () => {
    await writeOp({
      id: testUuid('stored'),
      seq: 1,
      userId: user.id,
      projectId: PROJECT_ID,
      entityId: TASK_ID,
      semantics: 'plain',
      label: 'read back from another build',
      request: {
        method: 'PATCH',
        path: '/api/tasks/{id}',
        pathParams: { id: TASK_ID },
        body: { title: 'new' },
      },
      queuedAt: 'not a date',
      attempts: 0,
    });
    unreachable();

    await outbox.hydrate();

    expect(outbox.pending.map((op) => op.label)).toEqual(['read back from another build']);
    expect(outbox.issues).toHaveLength(0);
  });

  // Kept as an issue rather than deleted: the panel still has to be able to show
  // what the change was, or the queue has lost work while claiming it did not.
  it('expires work that has waited longer than it keeps, and says what it was', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      unreachable();
      await outbox.submit(edit({ label: 'queued eight days ago' }));

      vi.setSystemTime(new Date('2026-01-09T00:00:00.000Z'));
      await outbox.submit(otherTaskEdit('typed just now'));

      expect(outbox.pending.map((op) => op.label)).toEqual(['typed just now']);
      expect(outbox.issues).toHaveLength(1);
      expect(outbox.issues[0]).toMatchObject({
        reason: 'expired',
        label: 'queued eight days ago',
      });
      expect(outbox.issues[0]?.request.body).toEqual({ title: 'new' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a queue that outlives its account', () => {
  it('drops unsent work and its issues when the session ends', async () => {
    unreachable();
    await outbox.submit(edit());
    expect(outbox.count).toBe(1);

    outbox.reset();

    expect(outbox.count).toBe(0);
    expect(outbox.issues).toHaveLength(0);
  });

  // Without this the next account's own queued work is never read back: hydrate
  // latches, and the latch used to survive the sign-out that cleared everything else.
  it('can hydrate again after a reset', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'first account' }));
    await outbox.hydrate();
    outbox.reset();
    expect(outbox.count).toBe(0);

    await outbox.hydrate();

    // An exact count, which is only meaningful because resetConnectionForTests
    // drops the stored rows as well as the connection.
    expect(outbox.count).toBe(1);
    expect(outbox.pending[0]?.label).toBe('first account');
  });

  // The drain resumes into whatever account is here now, and every branch of it
  // writes: an issue, a conflict draft, the queue itself.
  it('abandons a drain that resolves after the queue was reset', async () => {
    unreachable();
    await outbox.submit(edit());

    fetchMock.mockReset();
    let release = (): void => {};
    const held = new Promise<Response>((resolve) => {
      release = () => {
        resolve(jsonResponse(422, { error: 'Title is too long' }));
      };
    });
    fetchMock.mockImplementation(() => held);

    const draining = outbox.drain();
    outbox.reset();
    release();
    await draining;

    // The issue is what the abandoned run would have written; the count is only
    // here to show the reset itself stuck.
    expect(outbox.issues).toHaveLength(0);
    expect(outbox.count).toBe(0);
  });

  // `drain()` memoizes the run in flight, so a reset that leaves it in place
  // hands the next account's hydrate the abandoned promise instead of a drain of
  // its own — its work then sits unsent with no timer behind it.
  it('drains the next account after a reset abandoned a run mid-flight', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'account A' }));

    fetchMock.mockReset();
    let release = (): void => {};
    const held = new Promise<Response>((resolve) => {
      release = () => {
        resolve(jsonResponse(200, {}));
      };
    });
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? held : Promise.resolve(jsonResponse(200, {}));
    });

    const abandoned = outbox.drain();
    outbox.reset();

    // Still offline from the rejection above, so this queues rather than sending.
    await outbox.submit(edit({ label: 'account B' }));
    expect(outbox.count).toBe(1);

    const drained = outbox.drain();
    await vi.waitFor(() => {
      expect(outbox.count).toBe(0);
    });

    release();
    await Promise.all([abandoned, drained]);
  });
});

describe('two offline edits to the same card', () => {
  // Replayed separately the first would succeed and bump updated_at, and the
  // second would then conflict against a version this same user had just
  // written — a conflict with nobody.
  it('become one patch that keeps the original precondition', async () => {
    unreachable();
    await outbox.submit(
      edit({
        semantics: 'contentEdit',
        conflict: { taskId: TASK_ID, base: version('old'), mine: version('first') },
        request: {
          method: 'PATCH',
          path: '/api/tasks/{id}',
          pathParams: { id: TASK_ID },
          body: { title: 'first', expected_updated_at: 'v1' },
        },
      })
    );
    await outbox.submit(
      edit({
        semantics: 'contentEdit',
        conflict: { taskId: TASK_ID, base: version('first'), mine: version('second') },
        request: {
          method: 'PATCH',
          path: '/api/tasks/{id}',
          pathParams: { id: TASK_ID },
          body: { title: 'second', expected_updated_at: 'v2' },
        },
      })
    );

    expect(outbox.count).toBe(1);
    expect(outbox.pending[0]?.request.body).toEqual({
      title: 'second',
      expected_updated_at: 'v1',
    });
    // The version offered on conflict is the latest text against the baseline
    // the server actually confirmed.
    expect(outbox.pending[0]?.conflict).toEqual({
      taskId: TASK_ID,
      base: version('old'),
      mine: version('second'),
    });
  });
});
