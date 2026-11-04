/** Per-scope quota counters (section 12.2). */
export interface UsageStore {
  /** Returns the new value for the unit's scope. */
  add(dimension: string, delta: bigint): Promise<bigint>;
  get(dimension: string): Promise<bigint>;
}
