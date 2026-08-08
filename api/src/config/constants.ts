export const APP_NAME = 'Critical Path';

// Postgres caps a statement at 65,535 bind parameters, so every bulk copy
// writes in chunks rather than one insert that would 500 partway through work
// it has already done. Sized for the widest row any of them writes: a task
// carries seven bound columns, which leaves 30,000 parameters of headroom.
export const BULK_INSERT_CHUNK = 5000;

// A board this size is already past what any screen renders usefully, and an
// unbounded one that can be duplicated repeatedly is a denial-of-service
// amplifier rather than a feature. Archived cards count: they hold rows and
// sort keys exactly like live ones, so exempting them would leave the ceiling
// unbounded to anyone willing to archive as they go.
export const MAX_TASKS_PER_PROJECT = 5000;
