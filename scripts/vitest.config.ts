import { defineConfig } from 'vitest/config';

// The workspace scripts' own tests; they read files and start nothing.
export default defineConfig({ test: { name: 'scripts', include: ['test/**/*.test.ts'] } });
