import { heartbeatEveryMs } from '../control/heartbeat-every-ms.ts';
import { heartbeatProcess } from '../control/heartbeat-process.ts';
import { m2Phases } from './m2-phases.ts';
import type { StartPhaseInput } from './start-phase-input.ts';

/** What `start` leaves running. */
export interface Started {
  /** Settles when the scope directory stops following the control namespace's feed. */
  readonly following: Promise<void>;
  /** Ends the following and the heartbeat. */
  unfollow(): void;
  /** Stops what `m2Phases` started; settles when each has stopped or failed (each failure logged as a warning). */
  stopPhases(deadline: AbortSignal): Promise<void>;
}

/**
 * `start` (section 3.3), after data is available and before any listener accepts traffic: the
 * scope directory follows the control namespace's change feed so a changed or suspended backend or
 * tenant is dropped from the cache, and the runtime services of `m2Phases` start (the workers of a
 * process with the `work` role among them). Every process stamps its `core.process` row every 10 s
 * (19.1). The phases run before the heartbeat interval exists: one that throws synchronously stops
 * the phases already started and rethrows, so a failed start leaves no timer behind.
 */
export function startPhase(input: StartPhaseInput): Started {
  const { connected, migrated } = input;
  const follow = new AbortController();
  const stops: ((deadline: AbortSignal) => Promise<void>)[] = [];
  try {
    for (const phase of m2Phases) stops.push(phase(input));
  } catch (error) {
    const now = AbortSignal.abort();
    for (const stop of stops) {
      void (async () => {
        try {
          await stop(now);
        } catch (failure) {
          connected.log.warn('a runtime service did not stop cleanly', { cause: failure });
        }
      })();
    }
    throw error;
  }
  const beating = setInterval(() => {
    heartbeatProcess(connected.control, connected.processId).catch((error: unknown) => {
      connected.log.warn('the process could not stamp its heartbeat', { cause: error });
    });
  }, heartbeatEveryMs);
  beating.unref();
  return {
    following: migrated.directory.follow(follow.signal),
    unfollow: () => {
      clearInterval(beating);
      follow.abort();
    },
    stopPhases: async (deadline) => {
      const settled = await Promise.allSettled(stops.map(async (stop) => stop(deadline)));
      for (const result of settled) {
        if (result.status === 'rejected') {
          connected.log.warn('a runtime service did not stop cleanly', { cause: result.reason });
        }
      }
    },
  };
}
