import { ApiError } from '../api/client';

/**
 * The server's own words when it answered, and `fallback` when it did not — a
 * fetch that never landed rejects as a TypeError carrying nothing worth showing.
 * Callers with a specific action to name pass their own fallback.
 */
export function apiMessage(
  error: unknown,
  fallback = 'Could not reach the server. Check your connection and try again.'
): string {
  return error instanceof ApiError ? error.message : fallback;
}
