import { ApiError } from '../api/client';

export function apiMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  return 'Could not reach the server. Check your connection and try again.';
}
