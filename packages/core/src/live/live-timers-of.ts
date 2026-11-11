import type { Clock } from '../kernel/clock.ts';
import type { LiveTimers } from './live-timers.ts';

/** The longest delay `setTimeout` takes: 2^31 - 1 milliseconds. */
const longestDelayMs = 2_147_483_647;

/**
 * The timers of a runtime: `sleepUntil` runs a `setTimeout` for the time the clock says is left, then
 * asks the clock again and waits on until it has reached the instant, so a wait is never early
 * whatever the timer does. The timer is unreferenced, so a wait never keeps the process alive, and an
 * abort clears it and removes its listener.
 */
export function liveTimersOf(clock: Clock): LiveTimers {
  return {
    sleepUntil: (at, signal) =>
      new Promise<boolean>((resolve) => {
        if (signal.aborted) {
          resolve(false);
          return;
        }
        let handle: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => {
          clearTimeout(handle);
          resolve(false);
        };
        const arm = (): void => {
          const left = at.epochMilliseconds - clock.now().epochMilliseconds;
          if (Temporal.Instant.compare(clock.now(), at) >= 0) {
            signal.removeEventListener('abort', onAbort);
            resolve(true);
            return;
          }
          handle = setTimeout(arm, Math.min(Math.max(left, 1), longestDelayMs));
          handle.unref();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        arm();
      }),
  };
}
