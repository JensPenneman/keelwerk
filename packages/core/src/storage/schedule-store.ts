import type { StoredSchedule } from './stored-schedule.ts';

/** The schedule table (sections 9.5.6 and 14.3.9, S-118); `JobStore.schedules()` returns it from WP-82. */
export interface ScheduleStore {
  /** In this unit's scope; keeps an existing row's nextTick. */
  upsert(scheduleId: string, nextTick: Temporal.Instant): Promise<void>;
  /** A namespace unit sees every scope, any other unit its own. */
  due(now: Temporal.Instant, limit: number): Promise<readonly StoredSchedule[]>;
  /**
   * Conditional on nextTick = expected: true for one caller per tick and scope; a missed tick runs
   * once.
   */
  claimTick(
    scheduleId: string,
    scopeId: string,
    expected: Temporal.Instant,
    next: Temporal.Instant,
  ): Promise<boolean>;
}
