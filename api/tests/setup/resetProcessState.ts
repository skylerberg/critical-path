import { beforeAll, beforeEach } from 'vitest';

// The process-global singletons no single test owns, reset in one shared place
// rather than in whichever files remembered to. Per test as well as per file:
// vitest forks a process per file, so the cross-file half is already covered,
// and what was actually leaking was one test in a file into the next.
//
// Only state a test cannot legitimately have set up in `beforeAll` belongs here.
// The realtime socket registry (`socketStates`, `projectRooms`), the bus
// (`subscribers`, `remotePublish`) and the job handler registry (`handlers`) are
// deliberately absent: several files open sockets, subscribe, or register
// handlers once for the whole file, and clearing those between tests would break
// them rather than isolate them. Those stay each file's own responsibility.
let resets: Array<() => void> = [];

// Resolved inside a hook rather than at the top of the file: a setup file that
// imports eagerly resolves its dependencies ahead of any vi.mock a test file
// declares for them, and the test then runs against the real ones. Cached rather
// than re-imported per test so the per-test hook stays two synchronous calls,
// which is what keeps it off the critical path of a 2,300-test suite.
beforeAll(async () => {
  if (resets.length === 0) {
    const [{ resetRateLimiter }, { resetInFlightJobs }] = await Promise.all([
      import('../../src/services/rateLimit'),
      import('../../src/services/jobs/worker'),
    ]);
    resets = [resetRateLimiter, resetInFlightJobs];
  }
  for (const reset of resets) reset();
});

beforeEach(() => {
  for (const reset of resets) reset();
});
