import { defineConfig } from 'vitest/config';
import { postgresProjectRun } from '../../scripts/postgres-project-run.ts';

export default defineConfig({
  test: {
    name: 'spike-write-path',
    include: ['src/**/*.test.ts'],
    ...postgresProjectRun,
    // The integration tests start one PostgreSQL 18 container in beforeAll.
    hookTimeout: 120_000,
    testTimeout: 60_000,
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
