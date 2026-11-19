import { defineConfig } from 'vitest/config';
import { postgresProjectRun } from '../../scripts/postgres-project-run.ts';

// Tests that start a PostgreSQL container; every other project runs without Docker.
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'events-postgres',
    include: ['test/**/*.postgres.test.ts'],
    ...postgresProjectRun,
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
