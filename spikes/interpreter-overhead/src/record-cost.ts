import type { Summary } from './summary.ts';

/** The cost of the decision record of a decision with a number of loads. */
export interface RecordCost {
  readonly loads: number;
  /** Building the record: copying the reads, the answers and the effects (microseconds). */
  readonly build: Summary;
  /** Hashing an event whose chain content carries that record, minus the same event with an empty record. */
  readonly hash: Summary;
}
