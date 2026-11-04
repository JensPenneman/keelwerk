/** One row of `kw_job_groups`. */
export interface MemoryGroup {
  readonly id: string;
  readonly concurrency: number | null;
  readonly running: number;
  readonly rate: { readonly count: number; readonly periodMs: number } | null;
  readonly tokens: number;
  readonly refilledAt: Temporal.Instant;
  readonly blockedUntil: Temporal.Instant | null;
}
