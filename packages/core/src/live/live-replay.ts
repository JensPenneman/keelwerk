import type { Position } from '../storage/position.ts';

/**
 * What the disclosure rule (15.2.6) found for the streams that changed over a range, judged under
 * the subscriber's selection. `now`: readable now and matching, so the current row is sent. `lost`:
 * not readable now but readable at the start of the range, so the subscriber is told it left.
 * `uncertain`: step 5, the evidence did not suffice and the stream must reset to `resync`. A stream
 * in none of them was never readable by the subscriber and is not mentioned.
 */
export interface LiveReplay {
  readonly now: ReadonlyMap<string, { readonly createdAfter: boolean }>;
  readonly lost: ReadonlySet<string>;
  readonly uncertain: boolean;
  /** The position the answer is complete up to: the head, or the last event read when `maxStreams` cut it short. */
  readonly through: Position;
  readonly hasMore: boolean;
}
