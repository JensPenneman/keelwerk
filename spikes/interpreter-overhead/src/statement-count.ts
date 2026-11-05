/** One normalised statement as `pg_stat_statements` counts it, per measured command. */
export interface StatementCount {
  readonly query: string;
  readonly callsPerCommand: number;
  /** Server execution time per call, microseconds. */
  readonly microsPerCall: number;
}
