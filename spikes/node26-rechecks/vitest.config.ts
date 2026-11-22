import { configDefaults, defineConfig } from 'vitest/config';
import { testLimits } from '../../scripts/test-limits.ts';

export default defineConfig({
  test: {
    name: 'spike-node26-rechecks',
    ...testLimits,
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
