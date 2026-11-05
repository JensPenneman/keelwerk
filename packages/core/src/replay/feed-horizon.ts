/**
 * What a state read of a re-decide is checked against (section 7.9.6): the transient change
 * records of a `history: 'state'` entity are kept for the feed horizon only (section 15.1.10), so
 * a decision made before `retainedSince` can no longer be answered from them.
 */
export interface FeedHorizon {
  /** When the decision was made: the recording time of its events. */
  readonly decidedAt: Temporal.Instant;
  /** The oldest instant whose transient records are still kept: now minus the horizon. */
  readonly retainedSince: Temporal.Instant;
}
