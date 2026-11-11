/** What `reactionDispatcher()` takes (section 9.5.5). */
export interface ReactionDispatcherOptions {
  /** The queued cap of a scope's `reactions` lane (9.5.5); default 10,000, an integer of at least 1. */
  readonly queued?: number;
  /** How long a paused scope is held, in milliseconds; default 1,000, an integer of at least 1. */
  readonly holdMs?: number;
}
