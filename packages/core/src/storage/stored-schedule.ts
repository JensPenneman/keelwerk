/** One row of kw_schedules: a schedule in one scope (S-118). */
export interface StoredSchedule {
  readonly scheduleId: string;
  readonly scopeId: string;
  readonly lastTick: Temporal.Instant | null;
  readonly nextTick: Temporal.Instant;
}
