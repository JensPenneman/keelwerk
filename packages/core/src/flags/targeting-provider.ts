import type { FlagProvider } from './flag-provider.ts';

/** `core.targeting`: always first; answers nothing until targeting rules are stored (WP-98). */
export function targetingProvider(): FlagProvider {
  return {
    id: 'core.targeting',
    sync: true,
    start: () => Promise.resolve(),
    resolve: () => undefined,
  };
}
