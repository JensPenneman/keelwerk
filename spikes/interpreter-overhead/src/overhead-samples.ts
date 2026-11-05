import type { BenchCell } from './bench-cell.ts';
import type { BenchWorld } from './bench-world.ts';

/** The microseconds per command of every cell in every round, on one adapter. */
export interface OverheadSamples {
  readonly adapter: BenchWorld['label'];
  readonly cells: readonly BenchCell[];
  /** `perRound[round][cell]`, in the order of `cells`. */
  readonly perRound: readonly (readonly number[])[];
}
