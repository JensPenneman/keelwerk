import { defineConfig } from 'vitest/config';
import { testLimits } from '../../scripts/test-limits.ts';

export default defineConfig({
  test: {
    name: 'biome-config',
    ...testLimits,
    include: ['test/**/*.test.ts'],
  },
});
