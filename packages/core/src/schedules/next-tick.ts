import { durationMs } from '../effects/duration-ms.ts';
import { errors } from '../errors/errors.ts';

/**
 * The first instant strictly after `after` that is a whole multiple of `every` since the Unix epoch
 * (millisecond grid, UTC), so every process computes the same ticks and a schedule's ticks do not
 * depend on when it was first seen. `validation` for an unparsable or a zero duration.
 */
export function nextTick(every: string, after: Temporal.Instant): Temporal.Instant {
  const step = durationMs(every);
  if (step <= 0) throw errors.validation(`The schedule interval "${every}" is not above zero.`);
  return Temporal.Instant.fromEpochMilliseconds(
    (Math.floor(after.epochMilliseconds / step) + 1) * step,
  );
}
