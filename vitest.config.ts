import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*/vitest*.config.ts',
      'examples/*/apps/*/vitest*.config.ts',
      'spikes/*/vitest.config.ts',
    ],
  },
});
