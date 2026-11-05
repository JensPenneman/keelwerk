/** How long a measurement runs. */
export interface OverheadOptions {
  /** Commands per cell and round. */
  readonly iterations: number;
  /** Commands per cell before its timed run, discarded. */
  readonly warmup: number;
  /** Alternating rounds; the table takes the median over them. */
  readonly rounds: number;
}
