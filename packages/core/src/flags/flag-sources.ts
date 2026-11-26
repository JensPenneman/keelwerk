import type { FlagProvider } from './flag-provider.ts';
import type { TargetingCache } from './targeting-cache.ts';

/** What a path outside the invoker needs to build the flag snapshot a real call builds. */
export interface FlagSources {
  readonly providers: readonly FlagProvider[];
  readonly targeting?: Pick<TargetingCache, 'fresh'> | undefined;
}
