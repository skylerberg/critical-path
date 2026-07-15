import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    // The e2e suite shares one database, so files must not run concurrently;
    // this also forces a single worker.
    fileParallelism: false,
    include: ['tests/e2e/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    globalSetup: ['./tests/setup/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/db/types.ts'],
      reporter: ['text', 'html'],
    },
  },
});
