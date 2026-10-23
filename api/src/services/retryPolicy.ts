// One backoff policy for every at-least-once loop in the product — the job queue,
// webhook delivery and the recurring-series sweep. Only these numbers are shared:
// each queue keeps its own row-claiming query, its own lease columns and its own
// idea of a terminal failure, which is why they are not one queue.
export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
export const LEASE_SECONDS = 60;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_ERROR_CHARS = 2000;
