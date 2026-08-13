import { fetchMock, jsonResponse, requestAt } from '../api/testUtils';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import {
  isAlreadyApplied,
  sendRequest,
  type OpSemantics,
  type QueuedOp,
  type SendOutcome,
} from './outbox-ops';
import { testUuid } from './test-ids';

const TASK_ID = testUuid('t1');
const LABEL_ID = testUuid('l1');

function op(overrides: Partial<QueuedOp> = {}): QueuedOp {
  return {
    id: testUuid('op1'),
    seq: 1,
    userId: testUuid('u1'),
    projectId: testUuid('p1'),
    entityId: TASK_ID,
    semantics: 'plain',
    label: 'Renamed a card',
    request: {
      method: 'PATCH',
      path: '/api/tasks/{id}',
      pathParams: { id: TASK_ID },
      body: { title: 'new' },
    },
    queuedAt: '2026-01-01T00:00:00.000Z',
    attempts: 0,
    ...overrides,
  };
}

const ALL_SEMANTICS: OpSemantics[] = ['create', 'move', 'contentEdit', 'plain'];

function http(status: number, message = 'nope'): SendOutcome {
  return { kind: 'http', error: new ApiError(status, message) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('sendRequest', () => {
  it('hands back the payload when the server answers ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: TASK_ID, title: 'new' }));

    const outcome = await sendRequest({
      method: 'PATCH',
      path: '/api/tasks/{id}',
      pathParams: { id: TASK_ID },
      body: { title: 'new' },
    });

    expect(outcome).toEqual({ kind: 'ok', data: { id: TASK_ID, title: 'new' } });
  });

  it('is ok with nothing when the server answers 204', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));

    const outcome = await sendRequest({
      method: 'DELETE',
      path: '/api/labels/{id}',
      pathParams: { id: LABEL_ID },
    });

    expect(outcome.kind).toBe('ok');
  });

  it('substitutes path params into the url', async () => {
    fetchMock.mockResolvedValue(jsonResponse(204));

    await sendRequest({
      method: 'DELETE',
      path: '/api/labels/{id}',
      pathParams: { id: LABEL_ID },
    });

    const request = requestAt(0);
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe(`/api/labels/${LABEL_ID}`);
  });

  it('sends the stored body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await sendRequest({
      method: 'POST',
      path: '/api/checklist-items',
      body: { id: testUuid('ci1'), task_id: TASK_ID, text: 'buy milk' },
    });

    expect(await requestAt(0).json()).toEqual({
      id: testUuid('ci1'),
      task_id: TASK_ID,
      text: 'buy milk',
    });
  });

  it('leaves the url alone when there are no params to put in it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await sendRequest({ method: 'POST', path: '/api/checklist-items', body: {} });

    expect(requestAt(0).url).not.toContain('?');
  });

  // A non-2xx is a decision the server made, and the ApiError itself is carried
  // so the cycle reporter and duplicate-label handler keep working untouched.
  it('carries the ApiError for a request the server refused', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'That name is already taken' }));

    const outcome = await sendRequest({
      method: 'POST',
      path: '/api/labels',
      body: { name: 'bug' },
    });

    expect(outcome.kind).toBe('http');
    if (outcome.kind !== 'http') {
      throw new Error('expected an http outcome');
    }
    expect(outcome.error).toBeInstanceOf(ApiError);
    expect(outcome.error.status).toBe(409);
    expect(outcome.error.message).toBe('That name is already taken');
  });

  it('is http, not unreachable, for a server error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }));

    const outcome = await sendRequest({ method: 'POST', path: '/api/labels', body: {} });

    expect(outcome.kind).toBe('http');
  });

  // fetch rejects rather than resolving when the request never got an answer,
  // which is the only signal separating "offline" from "refused".
  it('is unreachable when the request never got an answer', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await sendRequest({ method: 'POST', path: '/api/labels', body: {} });

    expect(outcome).toEqual({ kind: 'unreachable' });
  });
});

describe('isAlreadyApplied', () => {
  it('is true only for a create that came back 409', () => {
    expect(isAlreadyApplied(op({ semantics: 'create' }), http(409))).toBe(true);
  });

  it('is false for every other semantics on the same 409', () => {
    for (const semantics of ALL_SEMANTICS.filter((s) => s !== 'create')) {
      expect(isAlreadyApplied(op({ semantics }), http(409))).toBe(false);
    }
  });

  it('is false for a create that came back any other status', () => {
    for (const status of [400, 403, 404, 410, 422, 500]) {
      expect(isAlreadyApplied(op({ semantics: 'create' }), http(status))).toBe(false);
    }
  });

  it('is false for a create that succeeded or never landed', () => {
    expect(isAlreadyApplied(op({ semantics: 'create' }), { kind: 'ok', data: {} })).toBe(false);
    expect(isAlreadyApplied(op({ semantics: 'create' }), { kind: 'unreachable' })).toBe(false);
  });

  it('is false across the whole matrix except the one true cell', () => {
    const outcomes: SendOutcome[] = [
      { kind: 'ok', data: {} },
      { kind: 'unreachable' },
      http(409),
      http(500),
    ];

    const trueCells = ALL_SEMANTICS.flatMap((semantics) =>
      outcomes
        .filter((outcome) => isAlreadyApplied(op({ semantics }), outcome))
        .map((outcome) => `${semantics}/${outcome.kind}`)
    );

    expect(trueCells).toEqual(['create/http']);
  });
});
