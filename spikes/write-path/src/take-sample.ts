/** One taker iteration: the take's unit, its take statement, and what it returned and completed. */
export interface TakeSample {
  readonly takeMs: number;
  readonly statementMs: number;
  readonly jobs: number;
  readonly completed: number;
}
