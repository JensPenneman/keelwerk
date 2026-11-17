import type { Meter } from '@keelwerk/core';

/** What `reactionDispatcher()` takes (section 9.5.5). */
export interface ReactionDispatcherOptions {
  /** The queued cap of a scope's `reactions` lane (9.5.5); default 10,000, an integer from 1 to 2,386,092,940. */
  readonly queued?: number;
  /** How long a paused scope is held, in milliseconds; default 1,000, an integer of at least 1. */
  readonly holdMs?: number;
  /**
   * The deepest lineage a reaction job may have (7.7); default 64, an integer from 1 to 2,147,483,646. A job
   * answers an event one level deeper than the job that wrote the event, so a chain of asynchronous
   * reactions that feeds itself (a reaction that writes what it hears, two that answer each other)
   * stops here: nothing further is queued, one line is logged and `keelwerk.reactions.faults`
   * counts a `depth_bound`. Deployment configuration, never module code. A chain meant to run
   * forever is a schedule, which starts at depth 0.
   */
  readonly maxDepth?: number;
  /**
   * Where the dispatcher counts a reaction it does not queue at the depth bound (`depth_bound` on
   * `keelwerk.reactions.faults`); the process's meter when absent.
   */
  readonly meter?: Meter;
}
