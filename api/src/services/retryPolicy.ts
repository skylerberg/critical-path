// The backoff schedule shared by every at-least-once loop: the job queue,
// webhook delivery and the recurring-series sweep. Only these numbers are shared
// — each queue keeps its own claiming and retry bookkeeping, because the three
// differ.
export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
export const LEASE_SECONDS = 60;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_ERROR_CHARS = 2000;
