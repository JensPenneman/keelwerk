import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'testing',
    include: ['src/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: 'tsconfig.test.json',
    },
  },
});
