import type { HostExit } from '../context/cli-host.ts';

/** Where a started app accepts traffic. */
export interface AppReady {
  readonly port: number | undefined;
  readonly socket: string | undefined;
}

/** The app child the supervisor started. */
export interface AppProcess {
  /** The ready line, or the exit of a child that never got there. */
  readonly ready: Promise<AppReady | HostExit>;
  /** Settles when the child has ended. */
  readonly exited: Promise<HostExit>;
  /** Asks the child to stop and kills it when the deadline passes. */
  stop(deadlineMs: number): Promise<void>;
}

/** True when `outcome` is the ready line and not an exit. */
export function isReady(outcome: AppReady | HostExit): outcome is AppReady {
  return !('code' in outcome);
}
