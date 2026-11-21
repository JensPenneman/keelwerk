import type { UsageCharge } from './usage-charge.ts';

/** Per-scope quota counters (section 12.2). */
export interface UsageStore {
  get(dimension: string): Promise<bigint>;
  /**
   * Buffers the charges for the commit tail, never I/O; the tail adds them to kw_usage and the unit
   * fails with rate_limited core.quota_exceeded (not retryable; details { dimension, limit, value })
   * when the unit's net charge of a dimension is above 0 and ends the counter above the smallest
   * limit the unit declared for it (a charge of 0n can declare a limit alone). A delta below 0 is
   * `internal`: `giveBack` lowers a counter. Refused in a namespace unit (internal).
   * An adapter also charges `core.eventBytes` itself, without a limit, for every event and stream
   * record a unit appends in a tenant or backend scope (`storedEventBytes`, `storedStreamRecordBytes`),
   * and gives the bytes back in the unit that removes one: a unit that declares no limit is never
   * refused for them.
   */
  charge(charges: readonly UsageCharge[]): void;
  /**
   * Buffers the lowering of a counter by `amount` for the commit tail, never I/O, with no limit: a
   * give-back is never refused. An `amount` below 0, a dimension of the framework (`core.`, that is
   * `core.eventBytes` and `core.rows`) and a namespace unit are `internal`: the adapter alone lowers
   * `core.eventBytes`, in the unit that removes the records, and nothing lowers `core.rows`; nothing
   * above the adapter may lower either. Nothing in the framework calls it. It is the way for code
   * above the adapter to lower a counter of its own dimension that it removes records of.
   */
  giveBack(dimension: string, amount: bigint): void;
}
