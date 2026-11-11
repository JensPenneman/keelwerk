import { durationMs } from '../effects/duration-ms.ts';
import { errors } from '../errors/errors.ts';

/**
 * The tick a due row stands for: its `nextTick` when that lies on the epoch grid of `every`, else
 * the grid point at or before it. A row is moved off the grid only by a deferral (a retry `retryMs`
 * after a failed unit, a stale row `staleMs` ahead), and a deferral follows a tick that made no
 * job, so the floor is that tick: the retry keeps its command id, its job key, its jitter and the
 * `at` its input is built with, and a tick that already ran is never named again (every later claim
 * moves the row past the floor). A row kept across a change of `every` may floor to an instant the old
 * grid already ran; the command id holds the period (`scheduleCommandId`), so that tick is a new one. `validation` for an unparsable or a zero `every`.
 */
export function tickOfRow(every: string, nextTick: Temporal.Instant): Temporal.Instant {
  const step = durationMs(every);
  if (step <= 0) throw errors.validation(`The schedule interval "${every}" is not above zero.`);
  const ms = nextTick.epochMilliseconds;
  return ms % step === 0
    ? nextTick
    : Temporal.Instant.fromEpochMilliseconds(Math.floor(ms / step) * step);
}
