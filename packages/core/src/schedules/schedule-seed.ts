import type { ScheduleEntry } from '../registry/schedule-entry.ts';
import type { ScheduleScope } from './schedule-scope.ts';

/** A scope of one schedule the seeding walks. */
export interface ScheduleSeed {
  readonly entry: ScheduleEntry;
  readonly target: ScheduleScope;
}
