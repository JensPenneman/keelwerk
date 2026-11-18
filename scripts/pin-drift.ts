import type { PinSources } from './pin-sources.ts';

/** A copy that does not follow its source. */
export interface PinDrift {
  readonly file: string;
  readonly source: keyof PinSources;
  /** The source's value. */
  readonly expected: string;
  /** Every value the pattern captured, in file order; fewer or more than the row's count is a drift too. */
  readonly found: readonly string[];
}
