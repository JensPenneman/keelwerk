import { heartbeatEveryMs } from '../control/heartbeat-every-ms.ts';
import { errors } from '../errors/errors.ts';
import { liveTimersOf } from '../live/live-timers-of.ts';
import type { RuntimeService } from './runtime-service.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/**
 * Service `core.leases`, roles `['serve', 'work']` (12.2, 15.4.10): `heartbeatEveryMs` of the
 * runtime clock (`input.options.timers ?? liveTimersOf(input.clock)`) after a pass has ended, the
 * next pass of the process's slots of the deployment-wide counts runs: it sets the leases to the slots in use, in parts of at most
 * 1,000 pairs, and sweeps the expired leases of every process. A failure is logged at warn and the
 * loop goes on; `stop` ends the loop and leaves the leases to expire. A start without slots
 * (`input.leases`) has nothing to do.
 */
export function keepLeases(input: StartPhaseInput): RuntimeService {
  const timers = input.options.timers ?? liveTimersOf(input.clock);
  const ending = new AbortController();
  let loop: Promise<void> | undefined;
  return {
    id: 'core.leases',
    roles: ['serve', 'work'],
    start: async (context) => {
      const { leases } = input;
      if (leases === undefined) return;
      const stopSignal = AbortSignal.any([ending.signal, context.signal]);
      loop = (async () => {
        let next = input.clock.now().add({ milliseconds: heartbeatEveryMs });
        while (await timers.sleepUntil(next, stopSignal)) {
          try {
            await leases.pass();
          } catch (error) {
            const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
            context.log.warn('the leases of the live counts could not be kept', { code });
          }
          next = input.clock.now().add({ milliseconds: heartbeatEveryMs });
        }
      })();
      await Promise.resolve();
    },
    stop: async () => {
      ending.abort(errors.unavailable('The lease keeper stopped.'));
      await loop;
    },
  };
}
