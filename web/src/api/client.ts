import createClient from 'openapi-fetch';
import type { Middleware } from 'openapi-fetch';
import type { paths } from './api.generated';
import { connectivity } from '../lib/connectivity.svelte';

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface AuthHooks {
  getToken: () => string | null;
  onUnauthorized: () => void;
}

// Injected by the session store to avoid a circular import.
let authHooks: AuthHooks | undefined;

export function setAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

// A wrong password answers 401 without invalidating the session, so it must not
// trip the global logout handler. Keyed by method as well as path because
// GET /api/auth/me shares a pathname with the delete and its 401 is exactly how
// a revoked token is detected.
const SESSION_SAFE_401 = new Set(['POST /api/auth/change-password', 'DELETE /api/auth/me']);

const bearerAuth: Middleware = {
  onRequest({ request }) {
    const token = authHooks?.getToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
  },
  onResponse({ request, response }) {
    if (
      response.status === 401 &&
      request.headers.has('Authorization') &&
      !SESSION_SAFE_401.has(`${request.method} ${new URL(request.url).pathname}`)
    ) {
      authHooks?.onUnauthorized();
    }
  },
};

// Every request is a reachability probe, so the answer is recorded here rather
// than guessed at from `navigator.onLine`. A 500 still proves the server is
// there; only a fetch that never got an answer says otherwise.
const reachability: Middleware = {
  onResponse() {
    connectivity.noteReached();
  },
  onError() {
    connectivity.noteUnreachable();
  },
};

export const api = createClient<paths>({ baseUrl: '' });
api.use(bearerAuth);
api.use(reachability);

export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export function assertOk<T>(result: ApiResult<T>): T {
  if (result.response.ok) {
    return result.data as T;
  }
  throw new ApiError(
    result.response.status,
    errorMessage(result.error, result.response),
    result.error
  );
}

function errorMessage(error: unknown, response: Response): string {
  if (error && typeof error === 'object') {
    const body = error as { error?: unknown; details?: unknown };
    if (Array.isArray(body.details) && body.details.length > 0) {
      const fields = (body.details as { path?: unknown; message?: unknown }[])
        .map((detail) => `${String(detail.path)}: ${String(detail.message)}`)
        .join(', ');
      return `Validation failed: ${fields}`;
    }
    if (typeof body.error === 'string' && body.error !== '') {
      return body.error;
    }
  }
  return `Request failed with status ${String(response.status)}`;
}
