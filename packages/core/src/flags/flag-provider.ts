import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { FlagContext } from './flag-context.ts';
import type { FlagSpec } from './flag-spec.ts';

/** Fills the deployment-level ordered point `flagProviders` (20.3). */
export interface FlagProvider {
  readonly id: string;
  /** True when `resolve` never returns a promise. */
  readonly sync: boolean;
  start(signal: AbortSignal): Promise<void>;
  /** `undefined` passes the flag to the next provider. */
  resolve<T>(
    flag: FlagSpec<T>,
    context: FlagContext,
  ): FlagResolution<T> | undefined | Promise<FlagResolution<T> | undefined>;
  readonly changes?: AsyncIterable<{ readonly keys: readonly string[] }>;
}
