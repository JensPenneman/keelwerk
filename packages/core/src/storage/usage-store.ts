import type { UsageCharge } from './usage-charge.ts';

/** Per-scope quota counters (section 12.2). */
export interface UsageStore {
  /** Returns the new value for the unit's scope. */
  add(dimension: string, delta: bigint): Promise<bigint>;
  get(dimension: string): Promise<bigint>;
  /**
   * Buffers the charges for the commit tail, never I/O; the tail adds them to kw_usage and the unit
   * fails with rate_limited core.quota_exceeded (not retryable; details { dimension, limit, value })
   * when the unit's net charge of a dimension is above 0 and ends the counter above the smallest
   * limit the unit declared for it (a charge of 0n can declare a limit alone). Refused in a namespace unit (internal).
   * An adapter also charges `core.eventBytes` itself, without a limit, for every event and stream
   * record a unit appends in a tenant or backend scope (`storedEventBytes`, `storedStreamRecordBytes`):
   * a unit that declares no limit is never refused for them.
   */
  charge(charges: readonly UsageCharge[]): void;
}
