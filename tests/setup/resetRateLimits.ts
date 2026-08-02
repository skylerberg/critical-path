import { beforeAll } from 'vitest';

// Test files share a worker, and with it the in-process limiter. Without this
// a file's remaining budget would depend on which files ran before it, so a
// file that grew past a cap would fail in whichever file happened to follow.
//
// Imported inside the hook, not at the top: a setup file that pulls the
// limiter in eagerly resolves its dependencies ahead of any vi.mock a test
// file declares for them, and the test then runs against the real ones.
beforeAll(async () => {
  const { resetRateLimiter } = await import('../../src/middleware/rateLimit');
  resetRateLimiter();
});
