import { fetchMock, jsonResponse } from '../api/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from './connectivity.svelte';
import { conflictDrafts } from './conflictDrafts.svelte';
import { outbox, type SubmitInput } from './outbox.svelte';
import { resetConnectionForTests } from './offline-db';
import { session } from './session.svelte';
import { testUuid } from './test-ids';

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
  it('replays in the order the work was done', async () => {
    unreachable();
    await outbox.submit(edit({ label: 'one', entityId: TASK_ID }));
    await outbox.submit(edit({ label: 'two', entityId: OTHER_ID }));

    fetchMock.mockReset();
    alwaysRespond(200);
    await outbox.drain();

    expect(outbox.count).toBe(0);
    const bodies = await Promise.all(
      fetchMock.mock.calls.map((call) => (call[0] as Request).clone().text())
    );
    expect(bodies).toHaveLength(2);
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

  async function queueMove(): Promise<void> {
    unreachable();
    await outbox.submit(
      edit({
        semantics: 'move',
        label: 'Moved a card',
        move: { columnId: COLUMN_ID, afterId: AFTER_ID, beforeId: BEFORE_ID },
        request: {
          method: 'PATCH',
          path: '/api/tasks/{id}',
          pathParams: { id: TASK_ID },
          // Computed against the board as it looked offline, and meaningless by
          // the time this is replayed.
          body: { column_id: COLUMN_ID, sort_key: 'V2' },
        },
      })
    );
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
      { id: AFTER_ID, sort_key: 'V0' },
      { id: BEFORE_ID, sort_key: 'V1' },
    ]);

    await outbox.drain();

    const sortKey = await replayedSortKey();
    expect(sortKey).toBeDefined();
    expect(sortKey! > 'V0' && sortKey! < 'V1').toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  it('keeps the intent when only one of the two neighbors is left', async () => {
    await queueMove();
    serveBoard([
      { id: AFTER_ID, sort_key: 'V0' },
      { id: testUuid('unrelated'), sort_key: 'V3' },
    ]);

    await outbox.drain();

    const sortKey = await replayedSortKey();
    expect(sortKey! > 'V0' && sortKey! < 'V3').toBe(true);
    expect(outbox.issues).toHaveLength(0);
  });

  // Falling back to the end of the column is a guess, and a guess the user is
  // told about rather than left to notice.
  it('appends and says so when both neighbors are gone', async () => {
    await queueMove();
    serveBoard([{ id: testUuid('unrelated'), sort_key: 'V3' }]);

    await outbox.drain();

    const sortKey = await replayedSortKey();
    expect(sortKey! > 'V3').toBe(true);
    expect(outbox.issues).toHaveLength(1);
    expect(outbox.issues[0]).toMatchObject({
      reason: 'approximate-placement',
      severity: 'adjusted',
    });
    // Adjusted, not failed: the move did land.
    expect(outbox.count).toBe(0);
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
