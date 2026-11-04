import type { CommitTailEvent } from './commit-tail-event.ts';
import type { CommitTailLane } from './commit-tail-lane.ts';

/** What the commit tail of one unit writes. */
export interface CommitTailInput {
  /** The namespace root (schema). */
  readonly root: string;
  /**
   * The scope's id: `scope_id` of the counter and the events, and the scope the lane counters are
   * matched against. Null only for a namespace-scope unit, which spans the scopes and has no events.
   */
  readonly scopeId: string | null;
  /** `backend_id` of the events. */
  readonly backendId: string;
  /** In append order; empty for a unit that only moves lane counters. */
  readonly events: readonly CommitTailEvent[];
  /** Per lane, summed; empty when the unit made no job available. */
  readonly lanes: readonly CommitTailLane[];
}
