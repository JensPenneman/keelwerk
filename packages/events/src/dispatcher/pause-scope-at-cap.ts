import type { Unit } from '@keelwerk/core';
import { KeelwerkError, reactionQueue } from '@keelwerk/core';

/**
 * Holds a scope whose `reactions` lane is nearly full (9.5.5): the jobs queued in the scope's lane
 * (available, scheduled and waiting, never running or dead), read in the scope's own unit, above 90
 * percent of `queued` throw `rate_limited`, `core.queue_full` with `retryAfter` of `holdMs`. The
 * batch's own jobs are not weighed, so one batch can overshoot the cap by its own jobs. The lane is
 * counted with the job store's bounded `queued`, asked for `floor(9 * queued / 10)` and so never
 * read past one job more than the line. The consumer runner answers by rolling the batch back,
 * counting nothing and holding that scope only, so the checkpoint stays and no other scope waits.
 * The scope resumes by itself: nothing is enqueued while it is held, and every queued job leaves
 * the queued states in bounded time, by being taken, by its retries ending or by its lease being
 * lost three times.
 */
export async function pauseScopeAtCap(unit: Unit, queued: number, holdMs: number): Promise<void> {
  // 90 percent of the cap, as a whole number: the lane holds more than 90 percent when it holds more jobs than this.
  const line = Math.floor((9 * queued) / 10);
  if ((await unit.jobs.queued(reactionQueue, line)) > line) {
    throw new KeelwerkError({
      kind: 'rate_limited',
      code: 'core.queue_full',
      message: 'The reaction queue of this scope is nearly full.',
      retryAfter: holdMs / 1000,
    });
  }
}
