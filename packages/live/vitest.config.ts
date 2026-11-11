import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'live',
    // The hub suites boot a runtime on the embedded database in beforeAll; on a slow or loaded machine
    // that takes longer than the default ten seconds.
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts', 'test/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
