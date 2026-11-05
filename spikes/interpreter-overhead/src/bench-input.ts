/** What the unit takes: the same four members as the measured commands. */
export interface BenchInput {
  readonly ids: readonly string[];
  readonly requests: number;
  readonly writeId: string;
  readonly hits: number;
}
