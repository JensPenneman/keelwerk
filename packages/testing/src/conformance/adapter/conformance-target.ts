import type { DataAdapter, NamespaceRef } from '@keelwerk/core';
import type { ConformanceClock } from './conformance-clock.ts';

/**
 * What a factory hands the suites: one adapter on one namespace of the placement, with the
 * tables of the conformance entities provisioned. `adapter` may change after `reset`.
 */
export interface ConformanceTarget {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  /** Empties every table the suites write to (rows, events, receipts, jobs, counters, keys); called before each case. */
  /**
   * The clock the adapter was created with; the job store cases advance it instead of waiting.
   * A target without one makes those cases wait on real time.
   */
  readonly clock?: ConformanceClock | undefined;
  reset(): Promise<void>;
  close(): Promise<void>;
}
