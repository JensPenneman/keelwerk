/**
 * The input of the generated `watch` (15.4.2); the wire names follow `query`, so the filter is
 * called `filter`.
 */
export interface WatchInput<F> {
  readonly ids?: readonly string[];
  readonly filter?: F;
  readonly fields?: readonly string[];
  readonly includeArchived?: boolean;
  /** `'beginning'` emits the current rows, then `head`, then follows (15.2.5). */
  readonly from?: 'now' | 'beginning';
  /** A `queryState` or `state` to resume from (15.4.2); M1's `watch` input member, a wire string (S-170). */
  readonly after?: string;
  /** For partitioned entities (15.1.4). */
  readonly partition?: string;
}
