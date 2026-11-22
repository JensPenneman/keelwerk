import { defineConfig } from 'vitest/config';
import { postgresProjectRun } from '../../scripts/postgres-project-run.ts';
import { testLimits } from '../../scripts/test-limits.ts';

export default defineConfig({
  test: {
    name: 'spike-write-path',
    ...testLimits,
    include: ['src/**/*.test.ts'],
    ...postgresProjectRun,
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
