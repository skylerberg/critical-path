import { beforeAll } from 'vitest';

// Worker processes are forked, not re-entered through vitest.config.ts, so
// this is what proves the derived name reached them. Without it a fork that
// missed the override would run against the shared database and pass, which is
// the failure the derived name exists to prevent.
beforeAll(async () => {
  const { resolveTestDatabaseName } = await import('./testDatabaseName');
  const expected = resolveTestDatabaseName();
  if (process.env.DB_DATABASE !== expected) {
    throw new Error(
      `This worker would use ${process.env.DB_DATABASE ?? '(unset)'} instead of ${expected}. ` +
        'Run the suite through vitest.config.ts rather than setting DB_DATABASE yourself.'
    );
  }
});
