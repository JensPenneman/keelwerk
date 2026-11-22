/**
 * The time limits of a case and of a hook, for every Vitest project. They end a hang: they lie far
 * above what a healthy case or hook needs, so a slow machine does not fail a case that keeps them.
 * scripts/test/test-limits.test.ts fails when a project configuration does not take them from here.
 */
export const testLimits: { readonly testTimeout: number; readonly hookTimeout: number } = {
  testTimeout: 60_000,
  hookTimeout: 120_000,
};
