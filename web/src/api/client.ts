import createClient from 'openapi-fetch';
import type { Middleware } from 'openapi-fetch';
import type { paths } from './api.generated';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
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

// A wrong current password answers 401 without invalidating the session, so it
// must not trip the global logout handler.
const SESSION_SAFE_401 = new Set(['/api/auth/change-password']);

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
      !SESSION_SAFE_401.has(new URL(request.url).pathname)
    ) {
      authHooks?.onUnauthorized();
    }
  },
};

export const api = createClient<paths>({ baseUrl: '' });
api.use(bearerAuth);

export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export function assertOk<T>(result: ApiResult<T>): T {
  if (result.response.ok) {
    return result.data as T;
  }
  throw new ApiError(result.response.status, errorMessage(result.error, result.response));
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
