import type { PinSources } from './pin-sources.ts';

/** One hand-written copy of a pin: where it is, how it is found and which source it follows. */
export interface PinCopy {
  /** Path relative to the repository root, with forward slashes. */
  readonly file: string;
  readonly source: keyof PinSources;
  /** Flags `gd`, exactly one capture group: the copied value, the only text a write replaces. */
  readonly pattern: RegExp;
  /** How many matches the file holds; any other number is a drift (the pattern went stale). */
  readonly count: number;
}
