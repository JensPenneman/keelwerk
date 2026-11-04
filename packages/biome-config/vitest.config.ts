import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'biome-config',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
