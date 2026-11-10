import type { FlagResolution } from '../contexts/flag-resolution.ts';
import type { FlagRead } from '../events/flag-read.ts';

/** The flags one invocation sees: one snapshot per invocation (20.3). */
export interface FlagSnapshot {
  read<T>(key: string): FlagResolution<T>;
  /** What was read, in order, for `meta.flags` (20.5). */
  readonly evaluations: readonly FlagRead[];
}
