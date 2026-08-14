import { fetchMock, jsonResponse } from '../api/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from './connectivity.svelte';
import { conflictDrafts } from './conflictDrafts.svelte';
import { outbox, type SubmitInput } from './outbox.svelte';
import { resetConnectionForTests } from './offline-db';
import { session } from './session.svelte';
import { testUuid } from './test-ids';

/**
 * What may happen to an op while it is on the wire.
 *
 * Every case here needs a send that is genuinely unfinished — a response the
 * test holds open — because the whole class of bug lives in the window between
 * the request going out and the answer coming back. A drain that completes
 * before the second thing happens reproduces none of it, which is why the
 * coalescing case in `outbox.test.ts` passed throughout.
 */
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

function version(title: string) {
  return { title, description: null };
}

function contentEdit(title: string, expected: string, base: string): SubmitInput {
  return {
    projectId: PROJECT_ID,
    entityId: TASK_ID,
    label: `Renamed to ${title}`,
    semantics: 'contentEdit',
    conflict: { taskId: TASK_ID, base: version(base), mine: version(title) },
    request: {
      method: 'PATCH',
      path: '/api/tasks/{id}',
      pathParams: { id: TASK_ID },
      body: { title, expected_updated_at: expected },
    },
  };
}

function plainEdit(label: string, entityId: string): SubmitInput {
  return {
    projectId: PROJECT_ID,
    entityId,
    label,
    request: {
      method: 'PATCH',
      path: '/api/tasks/{id}',
      pathParams: { id: entityId },
      body: { title: label },
    },
  };
}

function unreachable(): void {
  fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
}

/** An answer the test decides when to give, so the send is really in flight. */
function held(respond: () => Response | Promise<Response>): {
  response: Promise<Response>;
  release: () => void;
} {
  let release = (): void => {};
  const response = new Promise<Response>((resolve) => {
    release = () => {
      resolve(respond());
    };
  });
  return { response, release };
}

/** The op is claimed and dispatched by the time the first call is recorded. */
async function onTheWire(): Promise<void> {
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
}

function patchRequests(): Request[] {
  return fetchMock.mock.calls
    .map((call) => call[0] as Request)
    .filter((request) => request.method === 'PATCH');
}

async function patchBodies(): Promise<Record<string, unknown>[]> {
  return Promise.all(
    patchRequests().map(
      async (request) => (await request.clone().json()) as Record<string, unknown>
    )
  );
}

async function sentTitles(): Promise<unknown[]> {
  return (await patchBodies()).map((body) => body.title);
}

async function login(): Promise<void> {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'tok', user }));
  await session.login(user.email, 'password123');
  fetchMock.mockReset();
}

/** Queues one op by letting its immediate send fail to reach anyone. */
async function queueOffline(input: SubmitInput): Promise<void> {
  unreachable();
  await outbox.submit(input);
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

afterEach(() => {
  vi.useRealTimers();
});

describe('an edit typed while the previous one is on the wire', () => {
  // `#coalesce` merges into the op it finds for the card, and the object it used
  // to find was the one already being sent: the merge landed in a request that
  // had been serialized and dispatched, and the reply then retired it from
  // memory and from IndexedDB alike. No request carried the newer text and no
  // issue was raised — the queue reported success and the typing was gone.
  it('is sent rather than merged into the request already in flight', async () => {
    await queueOffline(contentEdit('first', 'v1', 'old'));
    expect(outbox.count).toBe(1);

    const first = held(() => jsonResponse(200, { id: TASK_ID, updated_at: 'v2' }));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? first.response
        : Promise.resolve(jsonResponse(200, { updated_at: 'v3' }));
    });

    const draining = outbox.drain();
    await onTheWire();
    await outbox.submit(contentEdit('second', 'v1', 'old'));

    first.release();
    await draining;

    expect(await sentTitles()).toEqual(['first', 'second']);
    // Empty because both landed, not because one was swallowed.
    expect(outbox.count).toBe(0);
    expect(outbox.issues).toHaveLength(0);
  });

  // Both edits were typed against 'v1', and the first PATCH is what moved the
  // row past it. Sending the second with the baseline the user typed against
  // asks the server to conflict this user with themselves — which is the same
  // conflict-with-nobody coalescing exists to prevent, in the window where
  // coalescing is not allowed to help.
  it('goes out against the version the accepted edit produced', async () => {
    await queueOffline(contentEdit('first', 'v1', 'old'));

    const first = held(() => jsonResponse(200, { id: TASK_ID, updated_at: 'v2' }));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return calls === 1
        ? first.response
        : Promise.resolve(jsonResponse(200, { updated_at: 'v3' }));
    });

    const draining = outbox.drain();
    await onTheWire();
    await outbox.submit(contentEdit('second', 'v1', 'old'));

    first.release();
    await draining;

    const bodies = await patchBodies();
    expect(bodies.map((body) => body.expected_updated_at)).toEqual(['v1', 'v2']);
    expect(outbox.issues).toHaveLength(0);
  });

  // In memory only would last until the tab is closed, and the queue's whole
  // claim is that it survives that: a reload would replay the precondition the
  // drain has already retired.
  it('carries the advanced version across a reload', async () => {
    await queueOffline(contentEdit('first', 'v1', 'old'));

    const first = held(() => jsonResponse(200, { id: TASK_ID, updated_at: 'v2' }));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      // Nothing answers after the first, so the second edit is still queued —
      // and still stored — when the reload happens.
      return calls === 1 ? first.response : Promise.reject(new TypeError('Failed to fetch'));
    });

    const draining = outbox.drain();
    await onTheWire();
    await outbox.submit(contentEdit('second', 'v1', 'old'));

    first.release();
    await draining;

    outbox.reset();
    await outbox.hydrate();

    expect(outbox.pending[0]?.request.body).toMatchObject({
      title: 'second',
      expected_updated_at: 'v2',
    });
  });

  /**
   * The same loss by the other route, and the retry counter with it.
   * `#bumpAttempts` rewrote the queue entry from the op the loop captured before
   * the send: it put the pre-merge text back over whatever had been merged in
   * behind it, and it counted the attempt against a copy the loop no longer
   * read, so the op it was retrying never ran out of attempts.
   */
  it('survives the in-flight op being retried after a server error', async () => {
    await queueOffline(contentEdit('first', 'v1', 'old'));

    const first = held(() => jsonResponse(503, { error: 'Service unavailable' }));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return first.response;
      }
      return Promise.resolve(
        calls <= 3 ? jsonResponse(503, { error: 'Service unavailable' }) : jsonResponse(200, {})
      );
    });

    const draining = outbox.drain();
    await onTheWire();
    await outbox.submit(contentEdit('second', 'v1', 'old'));

    first.release();
    await draining;

    // Three attempts and no more, then the newer edit — which the merge would
    // have hidden inside the first request and the retry would have overwritten.
    expect(await sentTitles()).toEqual(['first', 'first', 'first', 'second']);
    expect(outbox.issues.map((issue) => issue.reason)).toEqual(['server']);
    expect(outbox.count).toBe(0);
  });
});

describe('the bounds the queue enforces', () => {
  // Not a content-edit problem: `#enforceBounds` expires by position and age
  // with no semantics anywhere in it, and the position it expired was index 0 —
  // which during a drain is the op being sent. The user was told a change had
  // waited too long to be applied about a request that was answered moments
  // later.
  it('does not expire the op that is already being sent', async () => {
    await queueOffline(plainEdit('long-waiting change', TASK_ID));

    const first = held(() => jsonResponse(200, {}));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? first.response : Promise.resolve(jsonResponse(200, {}));
    });

    const draining = outbox.drain();
    await onTheWire();

    // Eight days on, so the op that is mid-send is past the age the queue keeps.
    const eightDaysOn = Date.now() + 8 * 24 * 60 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(eightDaysOn);
    await outbox.submit(plainEdit('typed just now', OTHER_ID));

    first.release();
    await draining;

    expect(outbox.issues).toHaveLength(0);
    expect(await sentTitles()).toEqual(['long-waiting change', 'typed just now']);
    expect(outbox.count).toBe(0);
  });
});

describe('an op taken off the queue for sending', () => {
  // Being on the wire is not being saved. Everything the UI reads — the card's
  // unsent marker, the pill's count, the panel's list and how long the oldest
  // change has waited — has to keep saying so for the length of the send, which
  // is precisely when the change is least safe.
  it('is still counted, listed and marked unsent while it is on the wire', async () => {
    await queueOffline(plainEdit('being sent', TASK_ID));
    const queuedAt = outbox.pending[0]?.queuedAt;

    const first = held(() => jsonResponse(200, {}));
    fetchMock.mockImplementation(() => first.response);

    const draining = outbox.drain();
    await onTheWire();

    expect(outbox.count).toBe(1);
    expect(outbox.pending.map((op) => op.label)).toEqual(['being sent']);
    expect(outbox.isPending(TASK_ID)).toBe(true);
    expect(outbox.oldestQueuedAt).toBe(queuedAt);

    first.release();
    await draining;

    expect(outbox.count).toBe(0);
    expect(outbox.isPending(TASK_ID)).toBe(false);
  });

  it('goes back to the head when the network never answered', async () => {
    await queueOffline(plainEdit('unanswered', TASK_ID));

    unreachable();
    await outbox.drain();

    expect(outbox.count).toBe(1);
    expect(outbox.pending[0]?.label).toBe('unanswered');
    expect(outbox.issues).toHaveLength(0);
  });

  // A queue whose only op is on the wire still has unsent work in it, and a
  // sign-out has to take that op with it like any other.
  it('does not come back into the next account after a reset', async () => {
    await queueOffline(plainEdit('account A', TASK_ID));

    const first = held(() => jsonResponse(500, {}));
    fetchMock.mockImplementation(() => first.response);

    const draining = outbox.drain();
    await onTheWire();

    outbox.reset();
    first.release();
    await draining;

    expect(outbox.count).toBe(0);
    expect(outbox.pending).toHaveLength(0);
  });

  // `#generation` answers "is this still the same queue", which is not the
  // question a release asks. Between the claim and the unwind a sign-out and a
  // fresh drain can have put someone else's op on the wire, and pushing that one
  // back among the queued work puts a live request where a merge can reach it.
  it('does not push the next account’s in-flight op back into its queue', async () => {
    await queueOffline(contentEdit('account A', 'v1', 'old'));

    const a = held(() => jsonResponse(200, {}));
    const b = held(() => jsonResponse(200, { updated_at: 'v2' }));
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return a.response;
      }
      return calls === 2 ? b.response : Promise.resolve(jsonResponse(200, { updated_at: 'v3' }));
    });

    const abandoned = outbox.drain();
    await onTheWire();

    outbox.reset();
    await outbox.submit(contentEdit('account B', 'v1', 'old'));
    const drained = outbox.drain();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    a.release();
    await abandoned;

    // B's op is still on the wire, so the next edit to that card must queue
    // behind it. A release that only asked whether *something* was claimed has
    // just moved B back among the mergeable work, where this merges into the
    // request already sent and is retired unsent with it.
    await outbox.submit(contentEdit('account B, edited again', 'v1', 'account B'));

    b.release();
    await drained;

    expect(await sentTitles()).toEqual(['account A', 'account B', 'account B, edited again']);
    expect(outbox.count).toBe(0);
  });

  /**
   * The op is durable from the moment it is submitted, so a hydrate landing
   * mid-drain reads back the very request being sent — and `hydrate` is
   * reachable there, since it awaits IndexedDB while `onReachable` is free to
   * start a drain.
   *
   * What is left behind is a second entry for one change: the panel counts it
   * twice, `oldestQueuedAt` reads it as two waits, and every later pass over the
   * queue treats it as two independent edits. It is not a second request only
   * because `#forget` retires by id and takes both copies with it.
   */
  it('is not queued a second time by a hydrate that lands mid-drain', async () => {
    await queueOffline(plainEdit('stored and sending', TASK_ID));

    const first = held(() => Promise.reject(new TypeError('Failed to fetch')));
    fetchMock.mockImplementation(() => first.response);

    const draining = outbox.drain();
    await onTheWire();
    await outbox.hydrate();

    first.release();
    await draining;

    expect(outbox.count).toBe(1);
    expect(outbox.pending.map((op) => op.label)).toEqual(['stored and sending']);
  });

  /**
   * `#release` and `#forget` are two halves of one invariant: an op comes off
   * `#ops` for a send and something has to decide whether it goes back. Retiring
   * without clearing the claim is not a stale value — the release puts an
   * accepted write back at the head and the loop sends it again, for as long as
   * the server keeps saying yes.
   *
   * The mock stops answering after a few calls so a regression fails here in a
   * second rather than running the worker out of memory.
   */
  it('is not sent again once the server has accepted it', async () => {
    await queueOffline(plainEdit('accepted once', TASK_ID));

    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return calls > 3
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse(200, {}));
    });

    await outbox.drain();

    expect(patchRequests()).toHaveLength(1);
    expect(outbox.count).toBe(0);
    expect(outbox.issues).toHaveLength(0);
  });
});
