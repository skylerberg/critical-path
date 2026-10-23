// Retry schedule shared by every at-least-once loop in the product — the job
// queue, webhook delivery and the recurring-series sweep. Only these numbers are
// shared: each loop keeps its own table and claim SQL because their lease
// semantics and terminal states differ.
export const BACKOFF_SECONDS = [30, 120, 600, 3600, 21600];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
export const LEASE_SECONDS = 60;
export const MAX_CONSECUTIVE_FAILURES = 5;
export const MAX_ERROR_CHARS = 2000;
