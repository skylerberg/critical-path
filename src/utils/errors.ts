export type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500;

export class AppError extends Error {
  constructor(
    public statusCode: AppErrorStatus,
    message: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
  }
}

// A caught value is `unknown`, and everything that logs or records one wants the
// same string out of it.
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}
