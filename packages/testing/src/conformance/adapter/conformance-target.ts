import type { DataAdapter, NamespaceRef } from '@keelwerk/core';

/**
 * What a factory hands the suites: one adapter on one namespace of the placement, with the
 * tables of the conformance entities provisioned. `adapter` may change after `reset`.
 */
export interface ConformanceTarget {
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  /** Empties every table the suites write to (rows, events, receipts, jobs, counters, keys); called before each case. */
  reset(): Promise<void>;
  close(): Promise<void>;
}
