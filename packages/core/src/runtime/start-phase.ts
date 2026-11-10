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
 * tenant is dropped from the cache. M1 runs no queue worker, reaction dispatcher, projection or
 * schedule (S-24); every process stamps its `core.process` row every 10 s (19.1), so a process with the `work` role logs that and starts nothing more.
 */
export function startPhase(input: StartPhaseInput): Started {
  const { connected, migrated, options } = input;
  if (options.role !== 'serve') {
    connected.log.info('this release runs no queue worker; the work role starts nothing', {
      role: options.role,
    });
  }
  const follow = new AbortController();
  const beating = setInterval(() => {
    heartbeatProcess(connected.control, connected.processId).catch((error: unknown) => {
      connected.log.warn('the process could not stamp its heartbeat', { cause: error });
    });
  }, heartbeatEveryMs);
  beating.unref();
  const stops = m2Phases.map((phase) => phase(input));
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
