import { heartbeatEveryMs } from '../control/heartbeat-every-ms.ts';
import { heartbeatProcess } from '../control/heartbeat-process.ts';
import type { Connected } from './connected.ts';
import type { Migrated } from './migrate-phase.ts';
import type { RuntimeOptions } from './runtime-options.ts';

/** What `start` leaves running. */
export interface Started {
  /** Settles when the scope directory stops following the control namespace's feed. */
  readonly following: Promise<void>;
  /** Ends the following and the heartbeat. */
  unfollow(): void;
}

/**
 * `start` (section 3.3), after data is available and before any listener accepts traffic: the
 * scope directory follows the control namespace's change feed so a changed or suspended backend or
 * tenant is dropped from the cache. M1 runs no queue worker, reaction dispatcher, projection or
 * schedule (S-24); every process stamps its `core.process` row every 10 s (19.1), so a process with the `work` role logs that and starts nothing more.
 */
export function startPhase(input: {
  readonly connected: Connected;
  readonly migrated: Migrated;
  readonly options: RuntimeOptions;
}): Started {
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
  return {
    following: migrated.directory.follow(follow.signal),
    unfollow: () => {
      clearInterval(beating);
      follow.abort();
    },
  };
}
