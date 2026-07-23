export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  conflict: 5,
  invalid: 6,
} as const;

export function exitCodeForStatus(status: number): number {
  switch (status) {
    case 401:
    case 429:
      return EXIT.auth;
    case 404:
      return EXIT.notFound;
    case 409:
      return EXIT.conflict;
    case 400:
    case 413:
    case 422:
      return EXIT.invalid;
    default:
      return EXIT.failure;
  }
}

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
