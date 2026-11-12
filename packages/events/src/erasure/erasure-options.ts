import type { ErasureRecord, ErasureStep, Scope } from '@keelwerk/core';

/** What `erasure()` takes (section 14.7.5). */
export interface ErasureOptions {
  /** How often the worker reads the control ledger after its start pass; default 1000, runtime clock. */
  readonly pollMs?: number;
  /** Streams per page of `kw_subject_refs`; default 100. */
  readonly pageSize?: number;
  /** Test seam: runs after each step commits; a throw aborts the record there (crash injection). */
  readonly afterStep?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
  /**
   * Test seam: runs inside the writing unit of a step, before the step's writes (the `streams`
   * step, once per stream, and the `flags` step, in the unit of the control command); a throw fails
   * the unit. It lets a test hold a unit in flight.
   */
  readonly insideStep?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
  /**
   * Test seam that stands in for the epoch of a tenant scope until the runtime bumps epochs at a
   * restore: an erasure finished at another epoch is run again. Default: the control store's.
   */
  readonly epochOf?: (scope: Scope) => number;
}
