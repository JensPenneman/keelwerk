import { defineConfig } from 'vitest/config';
import { testLimits } from '../../scripts/test-limits.ts';

export default defineConfig({
  test: {
    name: 'spike-composition-types',
    ...testLimits,
    include: ['src/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
