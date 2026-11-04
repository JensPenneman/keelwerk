import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ['@keelwerk/source', 'module', 'node', 'development|production'],
    },
  },
  test: {
    name: 'cli',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      checker: fileURLToPath(new URL('../../node_modules/.bin/tsc', import.meta.url)),
      include: ['src/**/*.test-d.ts', 'test/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
