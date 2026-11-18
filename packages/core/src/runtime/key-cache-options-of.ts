import type { KeyCacheOptions } from '../keys/key-cache.ts';
import type { RuntimeOptions } from './runtime-options.ts';

/**
 * The cache options of the unwrapped scope keys (14.7.4: they live 60 seconds). A process measures
 * the 60 seconds on the cache's own monotonic reading, so a wall clock that is set back cannot
 * keep a key longer. A run that was given a clock (a test) measures them on that clock, so moving
 * it expires them; that reading never runs backward either.
 */
export function keyCacheOptionsOf(
  options: Pick<RuntimeOptions, 'clock' | 'keyCache'>,
): KeyCacheOptions {
  const { clock } = options;
  let latest = 0;
  return {
    ...(options.keyCache?.ttlMs === undefined ? {} : { ttlMs: options.keyCache.ttlMs }),
    ...(clock === undefined
      ? {}
      : {
          now: () => {
            latest = Math.max(latest, clock.now().epochMilliseconds);
            return latest;
          },
        }),
  };
}
