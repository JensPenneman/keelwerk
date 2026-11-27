import { fileURLToPath } from 'node:url';

/**
 * The time limits of a case and of a hook, for every Vitest project. They end a hang: they lie far
 * above what a healthy case or hook needs, so a slow machine does not fail a case that keeps them.
 * The polling waits take the case limit as their own: `expect.poll` through the setting below,
 * `vi.waitFor` and `vi.waitUntil` through the set-up file, whose default limit would otherwise be one
 * second. scripts/test/test-limits.test.ts fails when a project configuration does not take them from here.
 */
export const testLimits: {
  readonly testTimeout: number;
  readonly hookTimeout: number;
  readonly expect: { readonly poll: { readonly timeout: number } };
  readonly setupFiles: string[];
} = {
  testTimeout: 60_000,
  hookTimeout: 120_000,
  expect: { poll: { timeout: 60_000 } },
  setupFiles: [fileURLToPath(new URL('./test-wait-limits.setup.ts', import.meta.url))],
};
