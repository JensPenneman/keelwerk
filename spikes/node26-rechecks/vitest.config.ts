import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'spike-node26-rechecks',
    include: ['src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/**/*.postgres.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
