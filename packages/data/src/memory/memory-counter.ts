/** The row of `kw_positions` for one scope: the next position to assign and the epoch. */
export interface MemoryCounter {
  readonly next: bigint;
  readonly epoch: number;
}
