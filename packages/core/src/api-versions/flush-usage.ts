import { errors } from '../errors/errors.ts';
import { liveTimersOf } from '../live/live-timers-of.ts';
import type { RuntimeService } from '../runtime/runtime-service.ts';
import type { StartPhaseInput } from '../runtime/start-phase-input.ts';

const everyMs = 60_000;

/** Service `core.apiUsage`, roles ['serve']: every 60 000 ms of the runtime clock (`input.options.timers ?? liveTimersOf(input.clock)`) `context.control.apiUsage.flush()`; a failure is logged at warn with its code and the counts wait for the next flush; `stop` ends the loop and flushes once more, raced against the deadline. */
export function flushUsage(input: StartPhaseInput): RuntimeService {
  const timers = input.options.timers ?? liveTimersOf(input.clock);
  const ending = new AbortController();
  let loop: Promise<void> | undefined;
  let flush: (() => Promise<void>) | undefined;
  return {
    id: 'core.apiUsage',
    roles: ['serve'],
    start: async (context) => {
      const { apiUsage } = context.control;
      flush = async () => {
        try {
          await apiUsage.flush();
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
          context.log.warn('the API usage counts could not be written', { code });
        }
      };
      const stopSignal = AbortSignal.any([ending.signal, context.signal]);
      loop = (async () => {
        let next = input.clock.now().add({ milliseconds: everyMs });
        while (await timers.sleepUntil(next, stopSignal)) {
          await flush?.();
          next = input.clock.now().add({ milliseconds: everyMs });
        }
      })();
      await Promise.resolve();
    },
    stop: async (deadline) => {
      ending.abort(errors.unavailable('The API usage flusher stopped.'));
      const settled = (async () => {
        await loop;
        await flush?.();
      })();
      const waitMs = Math.max(
        0,
        deadline.epochMilliseconds - Temporal.Now.instant().epochMilliseconds,
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, waitMs);
        timeout.unref();
      });
      await Promise.race([settled, expired]);
      clearTimeout(timeout);
    },
  };
}
