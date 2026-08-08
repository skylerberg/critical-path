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

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}
