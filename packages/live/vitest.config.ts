import { configDefaults, defineConfig } from 'vitest/config';
import { testLimits } from '../../scripts/test-limits.ts';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'live',
    ...testLimits,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts', 'test/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
