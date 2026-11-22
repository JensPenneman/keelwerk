import { defineConfig } from 'vitest/config';
import { testLimits } from './test-limits.ts';

// The workspace scripts' own tests; they read files and start nothing.
export default defineConfig({
  test: { name: 'scripts', ...testLimits, include: ['test/**/*.test.ts'] },
});
