/** Samples of writer backends (application names `w:<scope>:<worker>`) from pg_stat_activity. */
export interface WaitCounts {
  readonly samples: number;
  /** Backend observations with a heavyweight-lock wait. */
  readonly lockWaits: number;
  /** Lock waits whose blocking backends all belong to the waiter's own scope. */
  readonly sameScope: number;
  /** Lock waits with at least one blocking backend of another scope. */
  readonly crossScope: number;
  /** Observations per wait event (`type:event`, `CPU` when running without a wait event). */
  readonly events: Readonly<Record<string, number>>;
}
