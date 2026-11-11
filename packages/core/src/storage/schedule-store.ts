import type { StoredSchedule } from './stored-schedule.ts';

/** The schedule table (sections 9.5.6 and 14.3.9, S-118); `JobStore.schedules()` returns it from WP-82. */
export interface ScheduleStore {
  /** In this unit's scope; keeps an existing row's nextTick. */
  upsert(scheduleId: string, nextTick: Temporal.Instant): Promise<void>;
  /**
   * A namespace unit sees every scope, any other unit its own. Rows come ordered by next tick, then
   * scope id, then schedule id (binary order); with `after` only the rows that sort strictly after
   * that key, so that a caller walks the due rows window by window.
   */
  due(
    now: Temporal.Instant,
    limit: number,
    after?: Pick<StoredSchedule, 'nextTick' | 'scopeId' | 'scheduleId'>,
  ): Promise<readonly StoredSchedule[]>;
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
  /**
   * Deletes the row of one schedule in one scope; true when there was one. A namespace unit removes
   * any scope's row (the `maintenance` policy), any other unit its own. Its owners: the schedule
   * ticker, for a row whose backend or tenant is gone, and tenant deletion.
   */
  remove(scheduleId: string, scopeId: string): Promise<boolean>;
}
