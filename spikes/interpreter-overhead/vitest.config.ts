import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'spike-interpreter-overhead',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
