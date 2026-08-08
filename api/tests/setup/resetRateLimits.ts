import { beforeAll } from 'vitest';

// Pins each file's rate-limit budget to the file rather than to the runner's
// isolation setting. Today vitest forks a process per file, so the in-process
// limiter starts empty anyway; with isolate off, files would share a worker
// and a file that grew past a cap would fail in whichever file followed it.
//
// Imported inside the hook, not at the top: a setup file that pulls the
// limiter in eagerly resolves its dependencies ahead of any vi.mock a test
// file declares for them, and the test then runs against the real ones.
beforeAll(async () => {
  const { resetRateLimiter } = await import('../../src/middleware/rateLimit');
  resetRateLimiter();
});
