import { defineConfig } from 'vitest/config';
import { postgresProjectRun } from '../../scripts/postgres-project-run.ts';
import { testLimits } from '../../scripts/test-limits.ts';

// Tests that start a PostgreSQL container; every other project runs without Docker.
export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'adapter-postgres-postgres',
    ...testLimits,
    include: ['test/**/*.postgres.test.ts'],
    ...postgresProjectRun,
    globalSetup: ['test/support/global-setup.ts'],
    setupFiles: [...testLimits.setupFiles, 'test/support/connections-guard.ts'],
  },
});
