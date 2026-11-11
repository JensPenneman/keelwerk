import type { SchedulePassState } from './run-schedule-pass.ts';

const heldLimit = 1000;

/** Keeps a row out of the reads until `until` (a failed deferral); the oldest hold goes past 1000. */
export function holdScheduleRow(
  state: SchedulePassState,
  key: string,
  until: Temporal.Instant,
): void {
  if (state.held.size >= heldLimit && !state.held.has(key)) {
    const oldest = state.held.keys().next();
    if (oldest.done !== true) state.held.delete(oldest.value);
  }
  state.held.set(key, until);
}
