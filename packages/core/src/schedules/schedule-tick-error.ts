/**
 * Why a tick did not run: 'build' (the input function or its validation failed: the tick is
 * skipped) or 'unit' (the store, the sealing or the enqueue failed: the tick is retried). The message
 * names the stage only; the cause carries the detail.
 */
export class ScheduleTickError extends Error {
  readonly stage: 'build' | 'unit';

  constructor(stage: 'build' | 'unit', cause: unknown) {
    super(`A schedule tick failed at its ${stage} stage.`, { cause });
    this.name = 'ScheduleTickError';
    this.stage = stage;
  }
}
