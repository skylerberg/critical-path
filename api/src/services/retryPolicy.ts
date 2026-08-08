// One policy for every at-least-once loop in the product — the job queue,
// webhook delivery and the recurring-series sweep. Only the numbers are shared:
// the queues themselves stay separate because their claim SQL, lease semantics
// and terminal states differ.
export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
export const LEASE_SECONDS = 60;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_ERROR_CHARS = 2000;
