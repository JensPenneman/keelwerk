import { defineConfig } from 'vitest/config';

// Tests that start a PostgreSQL container; every other project runs without Docker.
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'app-portal-postgres',
    include: ['test/**/*.postgres.test.ts'],
    globalSetup: ['test/support/global-setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
