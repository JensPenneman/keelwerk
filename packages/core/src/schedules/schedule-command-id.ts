import { kernelCommandId } from '../ids/kernel-command-id.ts';

/**
 * The command id and the job key of one tick (final): `kernelCommandId('schedule', ref, scopeId,
 * <period in milliseconds>, <tick in epoch milliseconds>)`. The tick's claim in `kw_schedules`, the job
 * key and the receipt of the command each hold the rule that one tick of one schedule in one scope
 * runs once. The period is part of the identity because `kw_schedules` keeps a row across builds: when
 * `every` changes, the first tick of the new grid can lie on an instant the old grid already ran, and
 * it must not replay that tick's receipt.
 */
export function scheduleCommandId(
  ref: string,
  scopeId: string,
  periodMs: number,
  tick: Temporal.Instant,
): string {
  return kernelCommandId(
    'schedule',
    ref,
    scopeId,
    String(periodMs),
    String(tick.epochMilliseconds),
  );
}
