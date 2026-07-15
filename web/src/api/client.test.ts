import { fetchMock, jsonResponse, requestAt } from './testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, assertOk, setAuthHooks } from './client';

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to throw');
}

describe('assertOk', () => {
  it('returns data for a successful response', () => {
    const data = { id: 'u1' };
    expect(assertOk({ data, response: new Response(null, { status: 200 }) })).toBe(data);
  });

  it('returns undefined for a 204 response', () => {
    expect(assertOk({ data: undefined, response: new Response(null, { status: 204 }) })).toBe(
      undefined
    );
  });

  it('throws ApiError with the message from the error body', () => {
    const error = caught(() =>
      assertOk({
        error: { error: 'Email already taken' },
        response: new Response(null, { status: 409 }),
      })
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: 'Email already taken' });
  });

  it('composes validation details into the message', () => {
    const error = caught(() =>
      assertOk({
        error: {
          error: 'Validation failed',
          details: [{ path: 'email', message: 'must be an email address' }],
        },
        response: new Response(null, { status: 422 }),
      })
    );
    expect(error).toMatchObject({
      status: 422,
      message: 'Validation failed: email: must be an email address',
    });
  });

  it('falls back to a status message when the body has no error field', () => {
    const error = caught(() =>
      assertOk({ error: 'plain text', response: new Response(null, { status: 500 }) })
    );
    expect(error).toMatchObject({ status: 500, message: 'Request failed with status 500' });
  });
});

describe('auth middleware', () => {
  let onUnauthorized: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    fetchMock.mockReset();
    onUnauthorized = vi.fn<() => void>();
  });

  it('injects a Bearer token when the session has one', async () => {
    setAuthHooks({ getToken: () => 'tok-1', onUnauthorized });
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'u1', email: 'a@b.c', name: 'Ada' }));

    await api.GET('/api/auth/me');

    const request = requestAt(0);
    expect(new URL(request.url).pathname).toBe('/api/auth/me');
    expect(request.headers.get('authorization')).toBe('Bearer tok-1');
  });

  it('sends no Authorization header without a token', async () => {
    setAuthHooks({ getToken: () => null, onUnauthorized });
    fetchMock.mockResolvedValue(jsonResponse(200, { users: [] }));

    await api.GET('/api/users');

    expect(requestAt(0).headers.has('Authorization')).toBe(false);
  });

  it('reports 401 responses on authed requests', async () => {
    setAuthHooks({ getToken: () => 'stale', onUnauthorized });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));

    await api.GET('/api/auth/me');

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('ignores 401 responses on anonymous requests', async () => {
    setAuthHooks({ getToken: () => null, onUnauthorized });
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid credentials' }));

    await api.POST('/api/auth/login', { body: { email: 'a@b.c', password: 'nope' } });

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
